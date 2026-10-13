const $ = (id) => document.getElementById(id);

let page = 1,
  borough = '',
  restaurants = [],
  pendingDelete = null;

let listRequest = 0;

const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c]
  );

async function api(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) throw new Error(data.error || 'Request failed.');

  return data;
}

function address(r) {
  return [r.address?.building, r.address?.street, r.address?.zipcode]
    .filter(Boolean)
    .join(' ');
}

function dateString(value) {
  const date = new Date(value?.$date ?? value);

  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function showPage() {
  const current = location.hash.slice(1) || 'home';
  const target = ['home', 'about', 'restaurants', 'top-picks'].includes(current)
    ? current
    : 'home';

  document.querySelectorAll('.page').forEach((section) => {
    section.hidden = section.id !== target;
  });

  document.querySelectorAll('nav a').forEach((link) => {
    link.classList.toggle('active', link.hash === '#' + target);

    if (link.hash === '#' + target) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  if (target === 'restaurants') loadRestaurants();
  if (target === 'top-picks') loadTop();
}

window.addEventListener('hashchange', showPage);

async function loadRestaurants() {
  const request = ++listRequest;

  $('list-status').textContent = 'Loading restaurants…';
  $('previous').disabled = $('next').disabled = true;

  const query = new URLSearchParams({
    search: $('search').value,
    borough,
    page,
  });

  try {
    const [data, groups] = await Promise.all([
      api('/api/restaurants?' + query),
      api('/api/groups?' + new URLSearchParams({ search: $('search').value })),
    ]);

    if (request !== listRequest) return;

    const pages = Math.max(1, Math.ceil(data.total / data.limit));

    if (page > pages) {
      page = pages;
      return loadRestaurants();
    }

    restaurants = data.items;

    $('list-status').textContent =
      `${data.total.toLocaleString()} restaurants found${borough ? ' in ' + borough : ''}.`;

    $('borough-filters').innerHTML = [
      { _id: '', count: groups.reduce((sum, g) => sum + g.count, 0) },
      ...groups,
    ]
      .map(
        (g) => `
          <button
            type="button"
            data-borough="${esc(g._id || '')}"
            class="${borough === (g._id || '') ? 'selected' : ''}"
            aria-pressed="${borough === (g._id || '')}"
          >${esc(g._id || 'All')} (${g.count})</button>
        `
      )
      .join('');

    $('restaurant-rows').innerHTML =
      restaurants
        .map(
          (r) => `
            <tr>
              <td>
                ${esc(r.name)}
                <div class="muted">ID: ${esc(r.restaurant_id)}</div>
              </td>

              <td>${esc(r.borough)}</td>
              <td>${esc(r.cuisine)}</td>
              <td>${esc(address(r))}</td>

              <td class="grades">
                ${
                  (r.grades || [])
                    .map(
                      (g) => `
                        <div>${esc(dateString(g.date))} · ${esc(g.grade)} · ${esc(g.score)}</div>
                      `
                    )
                    .join('') || 'No inspections'
                }
              </td>

              <td>
                <button data-edit="${esc(r._id)}" class="secondary">Edit</button>
                <button data-delete="${esc(r._id)}" class="danger">Delete</button>
              </td>
            </tr>
          `
        )
        .join('') || '<tr><td colspan="6">No restaurants match your search.</td></tr>';

    $('page-info').textContent = `Page ${page} of ${pages}`;
    $('previous').disabled = page <= 1;
    $('next').disabled = page >= pages;
  } catch (error) {
    if (request === listRequest) {
      $('list-status').textContent = error.message;
      $('restaurant-rows').innerHTML = '';
    }
  }
}

async function loadTop() {
  $('top-status').textContent = 'Loading Top Picks…';
  $('top-list').innerHTML = '';

  try {
    const data = await api('/api/top-picks');

    $('top-status').textContent = data.length
      ? `${data.length} restaurants shown.`
      : 'No restaurants have an aggregated score greater than 90.';

    $('top-list').innerHTML = data
      .map((r, i) => {
        const photo =
          window.CRAVR_IMAGES?.restaurants?.[r.restaurant_id] ||
          'assets/restaurant-placeholder.svg';

        return `
          <article class="top-card">
            <div class="card-photo">
              <img
                src="${esc(photo)}"
                alt="${esc('Restaurant photo for ' + r.name)}"
                loading="lazy"
              >
              <span class="rank">
                No. ${String(i + 1).padStart(2, '0')}
              </span>
              <span class="photo-tag">
                ${esc(r.borough || 'Restaurant')}
              </span>
            </div>

            <div class="card-body">
              <p class="card-cuisine">
                ${esc(r.cuisine || 'Cuisine not listed')}
              </p>

              <h2>${esc(r.name || 'Restaurant')}</h2>

              <p class="card-description">
                ${esc(window.CRAVR_DESCRIPTIONS?.[r.restaurant_id] || '')}
              </p>

              <p class="card-address">
                <span aria-hidden="true">⌖</span>
                ${esc(address(r) || 'Address not listed')}
              </p>

              <div class="card-bottom">
                <div class="score">
                  <span>Combined score</span>
                  <strong>${esc(r.totalScore)}</strong>
                </div>

                <span class="inspection-count">
                  ${(r.grades || []).length} inspection records
                </span>
              </div>

              <details class="inspection-details">
                <summary>
                  View inspection history
                  <span aria-hidden="true">+</span>
                </summary>

                <div>
                  ${
                    (r.grades || [])
                      .map(
                        (g) => `
                          <p>
                            <time>${esc(dateString(g.date))}</time>
                            <span>Grade ${esc(g.grade)}</span>
                            <strong>${esc(g.score)}</strong>
                          </p>
                        `
                      )
                      .join('') || '<p>No inspections recorded.</p>'
                  }
                </div>
              </details>
            </div>
          </article>
        `;
      })
      .join('');

    $('top-list')
      .querySelectorAll('img')
      .forEach((img) => {
        img.addEventListener(
          'error',
          () => {
            img.src = 'assets/restaurant-placeholder.svg';
          },
          { once: true }
        );
      });
  } catch (error) {
    $('top-status').textContent = error.message;
  }
}

$('search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  page = 1;
  loadRestaurants();
});

$('clear-search').onclick = () => {
  $('search').value = '';
  borough = '';
  page = 1;
  loadRestaurants();
};

$('borough-filters').onclick = (event) => {
  const button = event.target.closest('[data-borough]');

  if (button) {
    borough = button.dataset.borough;
    page = 1;
    loadRestaurants();
  }
};

$('previous').onclick = () => {
  page--;
  loadRestaurants();
};

$('next').onclick = () => {
  page++;
  loadRestaurants();
};

function addGrade(g = { date: new Date().toISOString(), grade: 'A', score: 0 }) {
  const row = document.createElement('div');

  row.className = 'grade-row';

  row.innerHTML = `
    <label>
      Date
      <input
        class="grade-date"
        type="date"
        required
        value="${esc(dateString(g.date))}"
      >
    </label>

    <label>
      Grade
      <select class="grade-letter">
        ${['A', 'B', 'C', 'Z', 'P', 'Not Yet Graded']
          .map(
            (v) => `
              <option ${v === g.grade ? 'selected' : ''}>${v}</option>
            `
          )
          .join('')}
      </select>
    </label>

    <label>
      Score
      <input
        class="grade-score"
        type="number"
        min="-1"
        max="1000"
        step="any"
        required
        value="${esc(g.score)}"
      >
    </label>

    <button
      type="button"
      class="secondary remove-grade"
      aria-label="Remove inspection"
    >Remove</button>
  `;

  row.querySelector('.remove-grade').onclick = () => row.remove();

  $('grade-fields').append(row);
}

function openEditor(r) {
  const form = $('restaurant-form');

  form.reset();

  $('edit-id').value = r?._id || '';
  $('form-error').textContent = '';
  $('editor-title').textContent = r ? 'Edit restaurant' : 'Add restaurant';
  $('grade-fields').innerHTML = '';

  if (r) {
    for (const field of ['name', 'restaurant_id', 'borough', 'cuisine'])
      form.elements[field].value = r[field] || '';

    for (const field of ['building', 'street', 'zipcode'])
      form.elements[field].value = r.address?.[field] || '';

    (r.grades || []).forEach(addGrade);
  } else addGrade();

  $('editor').showModal();
  form.elements.name.focus();
}

$('add-button').onclick = () => openEditor();

$('add-grade').onclick = () => {
  if ($('grade-fields').children.length < 100) addGrade();
};

$('close-editor').onclick = $('cancel-editor').onclick = () => $('editor').close();

$('restaurant-rows').onclick = (event) => {
  const edit = event.target.closest('[data-edit]'),
    remove = event.target.closest('[data-delete]');

  if (edit) openEditor(restaurants.find((r) => r._id === edit.dataset.edit));

  if (remove) {
    pendingDelete = restaurants.find((r) => r._id === remove.dataset.delete);

    $('delete-description').textContent = pendingDelete.name;
    $('delete-error').textContent = '';
    $('delete-dialog').showModal();
  }
};

$('restaurant-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const form = event.target;
  const values = new FormData(form);
  const document = { address: {}, grades: [] };

  for (const field of ['name', 'restaurant_id', 'borough', 'cuisine'])
    document[field] = values.get(field);

  for (const field of ['building', 'street', 'zipcode'])
    document.address[field] = values.get(field);

  document.grades = [...$('grade-fields').children].map((row) => ({
    date: row.querySelector('.grade-date').value,
    grade: row.querySelector('.grade-letter').value,
    score: Number(row.querySelector('.grade-score').value),
  }));

  const identifier = $('edit-id').value;

  $('save-button').disabled = true;
  $('form-error').textContent = '';

  try {
    await api('/api/restaurants' + (identifier ? '/' + identifier : ''), {
      method: identifier ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(document),
    });

    $('editor').close();

    await loadRestaurants();
  } catch (error) {
    $('form-error').textContent = error.message;
  } finally {
    $('save-button').disabled = false;
  }
});

$('cancel-delete').onclick = () => $('delete-dialog').close();

$('confirm-delete').onclick = async () => {
  if (!pendingDelete) return;

  $('confirm-delete').disabled = true;

  try {
    await api('/api/restaurants/' + pendingDelete._id, { method: 'DELETE' });

    $('delete-dialog').close();
    pendingDelete = null;

    await loadRestaurants();
  } catch (error) {
    $('delete-error').textContent = error.message;
  } finally {
    $('confirm-delete').disabled = false;
  }
};

document.querySelectorAll('[data-image]').forEach((img) => {
  const source = window.CRAVR_IMAGES?.[img.dataset.image];

  if (source) {
    const fallback = img.src;

    img.addEventListener(
      'error',
      () => {
        img.src = fallback;
      },
      { once: true }
    );

    img.src = source;
  }
});

showPage();