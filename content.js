(() => {
  'use strict';

  // Prevent double-injection
  if (document.getElementById('fbgc-float-btn')) return;

  // ── UI Setup ──
  const btn = document.createElement('button');
  btn.id = 'fbgc-float-btn';
  btn.textContent = '📥 איסוף פרטים';
  document.body.appendChild(btn);

  const status = document.createElement('div');
  status.id = 'fbgc-status';
  document.body.appendChild(status);

  function showStatus(msg) {
    status.textContent = msg;
    status.style.display = 'block';
  }
  function hideStatus() { status.style.display = 'none'; }

  // ── Auto-scroll to load all requests ──
  async function autoScroll() {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    let prevHeight = 0;
    let stableCount = 0;
    const scrollEl = document.documentElement;

    for (let i = 0; i < 150; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await delay(1200);

      const curHeight = document.body.scrollHeight;
      if (curHeight === prevHeight) {
        stableCount++;
        if (stableCount >= 3) break;
      } else {
        stableCount = 0;
      }
      prevHeight = curHeight;
      showStatus(`⏬ גולל... (${i + 1}) — נטען ${document.body.scrollHeight}px`);
    }

    window.scrollTo(0, 0);
  }

  // ── Extraction helpers ──

  // Extract email from text
  function findEmail(text) {
    const m = text.match(/[\w.+-]+@[\w.-]+\.\w{2,}/);
    return m ? m[0] : '';
  }

  // Extract phone from text
  function findPhone(text) {
    const m = text.match(/(?:\+?\d[\d\s\-().]{6,}\d)/);
    return m ? m[0].trim() : '';
  }

  // Get today's date in DD/MM/YYYY
  function todayStr() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  }

  // ── Main scraping logic ──
  // Facebook DOM is highly dynamic. We use multiple strategies.

  function scrapeRequests() {
    const results = [];
    const seen = new Set();
    const today = todayStr();

    // Strategy 1: Look for the member request cards.
    // Each pending request is typically inside a container that has the person's
    // name as a link and their answers as text below it.
    // We look for elements with role="listitem" or specific patterns.

    // Broad approach: find all text blocks that look like question answers,
    // then walk up to find the associated name.

    // Facebook renders each request in a block. Let's try to find request
    // containers by looking for "Approve" / "Decline" button pairs,
    // which are unique to each member request card.
    const approveButtons = document.querySelectorAll(
      '[aria-label="Approve"], [aria-label="אישור"], [aria-label="Approve request"]'
    );

    approveButtons.forEach(approveBtn => {
      // Walk up to find the request card container (usually 5-10 levels up)
      let card = approveBtn;
      for (let i = 0; i < 12; i++) {
        if (!card.parentElement) break;
        card = card.parentElement;
        // A card typically has enough height and contains both name + answers
        if (card.offsetHeight > 120) break;
      }

      // Extract name: usually the first prominent link with the person's profile
      const nameLink = card.querySelector('a[role="link"] span, a[href*="/user/"] span, a[href*="facebook.com/"] strong, a strong');
      const name = nameLink ? nameLink.textContent.trim() : '';

      if (!name || seen.has(name)) return;

      // Extract all text content from the card
      const fullText = card.innerText || '';

      const email = findEmail(fullText);
      const phone = findPhone(fullText);

      // Only add if we got a name
      if (name) {
        seen.add(name);
        results.push({ name, email, phone, date: today });
      }
    });

    // Strategy 2: If strategy 1 found nothing, try a broader approach.
    // Look for all links that appear to be profile links within the main content area.
    if (results.length === 0) {
      // Find the main feed/content area
      const mainContent = document.querySelector('[role="main"]') || document.body;

      // Find all spans/strong elements inside links (potential names)
      const allLinks = mainContent.querySelectorAll('a[href*="/user/"], a[href*="profile.php"], a[role="link"]');

      allLinks.forEach(link => {
        const name = (link.textContent || '').trim();
        if (!name || name.length < 2 || name.length > 60 || seen.has(name)) return;

        // Walk up to find a logical container
        let container = link;
        for (let i = 0; i < 8; i++) {
          if (!container.parentElement) break;
          container = container.parentElement;
          if (container.offsetHeight > 100) break;
        }

        const fullText = container.innerText || '';

        // Only consider if the container has answers (email or phone patterns)
        const email = findEmail(fullText);
        const phone = findPhone(fullText);

        if (email || phone) {
          seen.add(name);
          results.push({ name, email, phone, date: today });
        }
      });
    }

    // Strategy 3: Fallback — scan all visible text blocks for Q&A patterns
    if (results.length === 0) {
      const allSpans = document.querySelectorAll('[role="main"] span');
      let currentName = '';
      let currentEmail = '';
      let currentPhone = '';

      allSpans.forEach(span => {
        const text = span.textContent.trim();
        if (!text) return;

        // Detect name-like text (short, no @ or digits heavy)
        const isNameLike = text.length > 1 && text.length < 50 &&
          !text.includes('@') && !/\d{4,}/.test(text) &&
          span.closest('a');

        if (isNameLike && span.closest('a')) {
          if (currentName && (currentEmail || currentPhone) && !seen.has(currentName)) {
            seen.add(currentName);
            results.push({
              name: currentName,
              email: currentEmail,
              phone: currentPhone,
              date: today
            });
          }
          currentName = text;
          currentEmail = '';
          currentPhone = '';
        }

        const e = findEmail(text);
        if (e) currentEmail = e;
        const p = findPhone(text);
        if (p) currentPhone = p;
      });

      // Push last
      if (currentName && (currentEmail || currentPhone) && !seen.has(currentName)) {
        seen.add(currentName);
        results.push({
          name: currentName,
          email: currentEmail,
          phone: currentPhone,
          date: today
        });
      }
    }

    return results;
  }

  // ── CSV Generation ──
  function toCSV(data) {
    const BOM = '\uFEFF';
    const header = 'שם,אימייל,טלפון,תאריך';
    const rows = data.map(r =>
      [r.name, r.email, r.phone, r.date]
        .map(v => `"${(v || '').replace(/"/g, '""')}"`)
        .join(',')
    );
    return BOM + header + '\n' + rows.join('\n');
  }

  function downloadCSV(data) {
    const csv = toCSV(data);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fb-group-requests-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyToClipboard(data) {
    const text = data.map(r =>
      `${r.name}\t${r.email}\t${r.phone}\t${r.date}`
    ).join('\n');
    navigator.clipboard.writeText('שם\tאימייל\tטלפון\tתאריך\n' + text)
      .then(() => alert('✅ הועתק ללוח!'))
      .catch(() => alert('❌ שגיאה בהעתקה'));
  }

  // ── Modal ──
  function showModal(data) {
    // Remove existing
    document.getElementById('fbgc-modal-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'fbgc-modal-overlay';
    overlay.innerHTML = `
      <div id="fbgc-modal">
        <div id="fbgc-modal-header">
          <h2>📋 תוצאות איסוף — ${data.length} בקשות</h2>
          <button class="fbgc-close">&times;</button>
        </div>
        <div id="fbgc-modal-actions">
          <button class="fbgc-btn-primary" id="fbgc-dl-csv">📥 הורד CSV</button>
          <button class="fbgc-btn-secondary" id="fbgc-copy">📋 העתק ללוח</button>
        </div>
        <div id="fbgc-modal-table-wrap">
          <table id="fbgc-modal-table">
            <thead><tr><th>#</th><th>שם</th><th>אימייל</th><th>טלפון</th><th>תאריך</th></tr></thead>
            <tbody>
              ${data.map((r, i) => `
                <tr>
                  <td>${i + 1}</td>
                  <td>${esc(r.name)}</td>
                  <td dir="ltr">${esc(r.email)}</td>
                  <td dir="ltr">${esc(r.phone)}</td>
                  <td>${esc(r.date)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('.fbgc-close').onclick = () => overlay.remove();
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
    overlay.querySelector('#fbgc-dl-csv').onclick = () => downloadCSV(data);
    overlay.querySelector('#fbgc-copy').onclick = () => copyToClipboard(data);
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // ── Main flow ──
  btn.addEventListener('click', async () => {
    btn.classList.add('collecting');
    btn.textContent = '⏳ אוסף נתונים...';

    showStatus('⏬ גולל לטעינת כל הבקשות...');
    await autoScroll();

    showStatus('🔍 סורק בקשות...');
    const data = scrapeRequests();

    hideStatus();
    btn.classList.remove('collecting');
    btn.textContent = '📥 איסוף פרטים';

    if (data.length === 0) {
      alert('לא נמצאו בקשות הצטרפות בדף זה.\n\nוודא שאתה בדף "בקשות חברות" של הקבוצה\nוודא שיש בקשות ממתינות.');
      return;
    }

    showModal(data);
  });

  console.log('[FB Group Collector] Loaded ✓');
})();
