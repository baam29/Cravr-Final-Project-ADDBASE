// Optional import for a NEW database only. Never replaces an existing collection.
const fs = require('fs');
const path = require('path');
const { MongoClient, BSON } = require('mongodb');
require('./server'); // Loads .env without starting the web server.
async function main() {
  const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017');
  try {
    await client.connect();
    const collection = client.db(process.env.DB_NAME || 'restaurantDB').collection(process.env.COLLECTION_NAME || 'restaurants');
    if (await collection.countDocuments({}) !== 0) throw new Error('Import stopped: this collection already contains data. Your existing records were preserved.');
    const documents = BSON.EJSON.parse(fs.readFileSync(path.join(__dirname, 'data/restaurants.json'), 'utf8'));
    const result = await collection.insertMany(documents);
    console.log(`Imported ${result.insertedCount} restaurants.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { await client.close(); }
}
main();
