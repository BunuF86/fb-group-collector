(() => {
  'use strict';

  if (document.getElementById('fbgc-float-btn')) return;

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

  async function autoScroll() {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    let prevHeight = 0;
    let stableCount = 0;

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
      showStatus(`⏬ גולל... (${i + 1})`);
    }
    window.scrollTo(0, 0);
  }

  function findEmail(text) {
    const m = text.match(/[\w.+-]+@[\w.-]+\.\w{2,}/);
    return m ? m[0] : '';
  }

  function findPhone(text) {
    // Israeli phone patterns: 05X-XXXXXXX, 05XXXXXXXX, +972...
    const patterns = [
      /(?:0[2-9]\d[\s\-.]?\d{3}[\s\-.]?\d{4})/,
      /(?:0[2-9]\d{8})/,
      /(?:\+972[\s\-.]?\d[\s\-.]?\d{3}[\s\-.]?\d{4})/,
      /(?:\+?\d[\d\s\-().]{7,}\d)/
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[0].trim();
    }
    return '';
  }

  function todayStr() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  }

  function scrapeRequests() {
    const results = [];
    const seen = new Set();
    const today = todayStr();
    const mainContent = document.querySelector('[role="main"]') || document.body;

    // Strategy: Find all "אשר" (Approve) buttons — each one belongs to a request card
    // We look for buttons with text "אשר" or "Approve"
    const allButtons = mainContent.querySelectorAll('div[role="button"], button');
    const approveButtons = [];
    
    allButtons.forEach(b => {
      const text = (b.textContent || '').trim();
      if (text === 'אשר' || text === 'Approve' || text === 'אשר הכל') {
        // Skip "אשר הכל" (Approve All)
        if (text === 'אשר הכל' || text === 'Approve all') return;
        if (text === 'אשר' || text === 'Approve') {
          approveButtons.push(b);
        }
      }
    });

    console.log(`[FBCollector] Found ${approveButtons.length} approve buttons`);

    approveButtons.forEach((approveBtn, idx) => {
      // Walk up to find the request card container
      // The card should contain: name, questions/answers, approve/decline buttons
      let card = approveBtn;
      for (let i = 0; i < 15; i++) {
        if (!card.parentElement) break;
        card = card.parentElement;
        // A request card is typically tall enough to contain all the info
        if (card.offsetHeight > 200 && card.offsetWidth > 300) break;
      }

      const fullText = card.innerText || '';
      
      // Find name: Look for links that are profile links
      // The name is typically in a bold/strong link near the top of the card
      let name = '';
      
      // Try: find <a> tags with href containing profile info, get their text
      const links = card.querySelectorAll('a');
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        const linkText = link.textContent.trim();
        // Profile links usually contain /user/ or just the person's name
        // Skip short/empty text and navigation links
        if (linkText.length >= 2 && linkText.length <= 50 && 
            !linkText.includes('קבוצ') && !linkText.includes('חבר') &&
            !linkText.includes('http') && !linkText.includes('@') &&
            !/\d{5,}/.test(linkText)) {
          // Check if this looks like a name (not a group name or UI element)
          if (href.includes('/user/') || href.includes('profile.php') || 
              href.includes('facebook.com/') || link.querySelector('strong, span')) {
            name = linkText;
            break;
          }
        }
      }

      // Fallback: try to find name from strong/heading elements
      if (!name) {
        const strongs = card.querySelectorAll('strong, h3, h4, [role="heading"]');
        for (const s of strongs) {
          const t = s.textContent.trim();
          if (t.length >= 2 && t.length <= 50 && !t.includes('@') && !/\d{5,}/.test(t)) {
            name = t;
            break;
          }
        }
      }

      if (!name || seen.has(name)) return;

      const email = findEmail(fullText);
      const phone = findPhone(fullText);

      seen.add(name);
      results.push({ name, email, phone, date: today });
      console.log(`[FBCollector] #${idx+1}: ${name} | ${email} | ${phone}`);
    });

    // Strategy 2: If no approve buttons found, try text-based scanning
    if (results.length === 0) {
      console.log('[FBCollector] Strategy 1 failed, trying text scan...');
      
      // Split page content into chunks by looking for name-like patterns
      // followed by email/phone patterns
      const textContent = mainContent.innerText || '';
      const lines = textContent.split('\n').map(l => l.trim()).filter(Boolean);
      
      let currentName = '';
      let currentEmail = '';
      let currentPhone = '';
      
      for (const line of lines) {
        const email = findEmail(line);
        const phone = findPhone(line);
        
        if (email) currentEmail = email;
        if (phone) currentPhone = phone;
        
        // Detect "אשר" button text as card separator
        if (line === 'אשר' || line === 'דחה') {
          if (currentName && (currentEmail || currentPhone) && !seen.has(currentName)) {
            seen.add(currentName);
            results.push({ name: currentName, email: currentEmail, phone: currentPhone, date: today });
          }
          // Don't reset name here — it comes before the buttons
        }
        
        // Detect "בקשות" (requests) header as separator between cards
        if (line.includes('לפני') && line.includes('שעות') || 
            line.includes('לפני') && line.includes('ימים') ||
            line.includes('לפני') && line.includes('דקות')) {
          // This is the timestamp line — the name should be just before it
          // Reset for next card
          if (currentName && (currentEmail || currentPhone) && !seen.has(currentName)) {
            seen.add(currentName);
            results.push({ name: currentName, email: currentEmail, phone: currentPhone, date: today });
          }
          currentEmail = '';
          currentPhone = '';
        }
        
        // A name-like line: short, no special chars, appears before questions
        if (line.length >= 2 && line.length <= 40 && 
            !line.includes('@') && !/\d{4,}/.test(line) &&
            !line.includes('אשר') && !line.includes('דחה') &&
            !line.includes('חבר') && !line.includes('קבוצ') &&
            !line.includes('לפני') && !line.includes('הצטרפ') &&
            !line.includes('סננים') && !line.includes('שאלות') &&
            !line.includes('מסכים') && !line.includes('תשובה') &&
            !line.includes('ניקוי') && !line.includes('החדשות') &&
            !line.includes('מידע') && !line.includes('יש לנו') &&
            !line.includes('אחת') && !line.includes('כדי') &&
            !line.includes('השאירו') && !line.includes('בקשות')) {
          currentName = line;
        }
      }
      
      // Push last
      if (currentName && (currentEmail || currentPhone) && !seen.has(currentName)) {
        seen.add(currentName);
        results.push({ name: currentName, email: currentEmail, phone: currentPhone, date: today });
      }
    }

    return results;
  }

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

  function showModal(data) {
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
      alert('לא נמצאו בקשות.\n\nפתח את Console (F12) וחפש [FBCollector] לפרטים.');
      return;
    }

    showModal(data);
  });

  console.log('[FB Group Collector] Loaded ✓ — v2');
})();
