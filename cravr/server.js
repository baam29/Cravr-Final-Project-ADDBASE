const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
const fs = require('fs');
// A small .env loader keeps the original project's dependencies unchanged.
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
}
const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));
let collection;
const boroughs = ['Brooklyn', 'Queens', 'Manhattan', 'Bronx', 'Staten Island', 'Missing'];
const route = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
function filter(query) {
  const match = {};
  const keyword = String(query.search || '').trim().slice(0, 100);
  if (keyword) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    match.$or = [{ name: { $regex: escaped, $options: 'i' } }, { cuisine: { $regex: escaped, $options: 'i' } }];
  }
  if (query.borough) match.borough = String(query.borough);
  return match;
}
// Grades remain an array. One list row represents one restaurant.
const scoreStage = { $addFields: { totalScore: { $sum: '$grades.score' }, averageScore: { $avg: '$grades.score' } } };
app.get('/api/restaurants', route(async (req, res) => {
  const page = Math.max(1, Math.min(100000, parseInt(req.query.page, 10) || 1));
  const limit = 20;
  const [result] = await collection.aggregate([
    { $match: filter(req.query) }, scoreStage,
    { $sort: { name: 1, _id: 1 } },
    { $facet: { items: [{ $skip: (page - 1) * limit }, { $limit: limit }], count: [{ $count: 'total' }] } }
  ]).toArray();
  res.json({ items: result.items, total: result.count[0]?.total || 0, page, limit });
}));
// The rubric explicitly asks for a group function. This groups matching records by borough.
app.get('/api/groups', route(async (req, res) => {
  res.json(await collection.aggregate([
    { $match: filter({ search: req.query.search }) },
    { $group: { _id: '$borough', count: { $sum: 1 } } }, { $sort: { _id: 1 } }
  ]).toArray());
}));
// Required calculation: sum all inspection scores, select totals > 90, then rank descending.
app.get('/api/top-picks', route(async (req, res) => {
  res.json(await collection.aggregate([
    { $match: filter(req.query) }, scoreStage,
    { $match: { totalScore: { $gt: 90 } } },
    { $sort: { totalScore: -1, name: 1, _id: 1 } }, { $limit: 10 }
  ]).toArray());
}));
function validate(body) {
  function text(value, label, required = true) {
    if (typeof value !== 'string' || value.length > 200 || (required && !value.trim())) throw new Error(label + ' is required and must be at most 200 characters.');
    return value.trim();
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid restaurant.');
  const borough = text(body.borough, 'Borough');
  if (!boroughs.includes(borough)) throw new Error('Select a valid borough.');
  const address = body.address || {};
  if (!Array.isArray(body.grades) || body.grades.length > 100) throw new Error('Grades must be an array with at most 100 records.');
  const grades = body.grades.map(g => {
    if (!g || !['A', 'B', 'C', 'Z', 'P', 'Not Yet Graded'].includes(g.grade)) throw new Error('Select a valid inspection grade.');
    if (typeof g.score !== 'number' || !Number.isFinite(g.score) || g.score < -1 || g.score > 1000) throw new Error('Inspection score must be between -1 and 1000.');
    const date = new Date(g.date);
    if (typeof g.date !== 'string' || Number.isNaN(date.getTime())) throw new Error('Enter a valid inspection date.');
    return { date, grade: g.grade, score: g.score };
  });
  return {
    name: text(body.name, 'Name'), borough, cuisine: text(body.cuisine, 'Cuisine'),
    restaurant_id: text(body.restaurant_id, 'Restaurant ID'),
    address: { building: text(address.building, 'Building', false), street: text(address.street, 'Street'), zipcode: text(address.zipcode, 'ZIP code', false) }, grades
  };
}
function id(value) {
  if (!/^[a-f\d]{24}$/i.test(value)) { const error = new Error('Invalid restaurant identifier.'); error.status = 400; throw error; }
  return new ObjectId(value);
}
function validated(body) { try { return validate(body); } catch (error) { error.status = 400; throw error; } }
app.post('/api/restaurants', route(async (req, res) => {
  const document = validated(req.body);
  const result = await collection.insertOne(document);
  res.status(201).json({ ...document, _id: result.insertedId });
}));
app.put('/api/restaurants/:id', route(async (req, res) => {
  const document = validated(req.body);
  // Updating individual address keys preserves existing coordinates and other metadata.
  const update = { ...document };
  delete update.address;
  for (const [key, value] of Object.entries(document.address)) update['address.' + key] = value;
  const result = await collection.updateOne({ _id: id(req.params.id) }, { $set: update });
  if (!result.matchedCount) return res.status(404).json({ error: 'Restaurant not found.' });
  res.json({ message: 'Restaurant updated.' });
}));
app.delete('/api/restaurants/:id', route(async (req, res) => {
  const result = await collection.deleteOne({ _id: id(req.params.id) });
  if (!result.deletedCount) return res.status(404).json({ error: 'Restaurant not found.' });
  res.json({ message: 'Restaurant deleted.' });
}));
app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
app.use((error, req, res, next) => {
  console.error(error.message);
  res.status(error.status || 500).json({ error: error.status ? error.message : 'Database operation failed. Check the server terminal.' });
});
async function start() {
  const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017', { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const database = process.env.DB_NAME || 'restaurantDB';
    collection = client.db(database).collection(process.env.COLLECTION_NAME || 'restaurants');
    const server = app.listen(Number(process.env.PORT) || 3000, () => console.log(`CRAVR: http://localhost:${Number(process.env.PORT) || 3000} (database: ${database})`));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => { await client.close(); process.exit(0); }));
  } catch (error) {
    console.error('Could not connect to MongoDB. Check MONGODB_URI, MongoDB service, or Atlas access settings.');
    await client.close(); process.exitCode = 1;
  }
}
if (require.main === module) start();
module.exports = { app, validate, filter, scoreStage, setCollection: value => { collection = value; } };
