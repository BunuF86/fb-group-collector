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
    const patterns = [
      /0[2-9]\d[\s\-.]?\d{3}[\s\-.]?\d{4}/,
      /0[2-9]\d{8}/,
      /\+972[\s\-.]?\d[\s\-.]?\d{3}[\s\-.]?\d{4}/,
      /\+?\d[\d\s\-().]{7,}\d/
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
    const fullPageText = mainContent.innerText || '';

    // ── Strategy: Text-based parsing ──
    // Split the page text into sections per request card
    // Each card has: Name, timestamp, mutual friends info, Q&A answers, אשר/דחה buttons
    
    // Split by "אשר" button text which appears for each card
    // Pattern: each request ends with אשר + דחה buttons
    
    const lines = fullPageText.split('\n').map(l => l.trim()).filter(Boolean);
    
    console.log(`[FBCollector] Total lines: ${lines.length}`);
    
    // Find indices of "אשר" lines (each marks end of a request card area)
    // But "אשר הכל" is the bulk approve button, skip it
    const approveIndices = [];
    lines.forEach((line, i) => {
      if (line === 'אשר' || line === 'Approve') {
        approveIndices.push(i);
      }
    });
    
    console.log(`[FBCollector] Found ${approveIndices.length} request markers`);

    // For each approve marker, look backwards to find name, email, phone
    approveIndices.forEach((approveIdx, cardNum) => {
      // Get the text block for this card (from previous approve to this one)
      const startIdx = cardNum > 0 ? approveIndices[cardNum - 1] + 1 : 0;
      const cardLines = lines.slice(startIdx, approveIdx);
      const cardText = cardLines.join('\n');
      
      console.log(`[FBCollector] Card ${cardNum + 1} lines:`, cardLines.slice(0, 5));
      
      // Find email and phone in card text
      const email = findEmail(cardText);
      const phone = findPhone(cardText);
      
      // Find name: look for a line that looks like a person's name
      // It's typically one of the first lines, short, no special chars
      // Often followed by "שלחה/שלח לך בקשת חברות" or timestamp
      let name = '';
      
      for (const line of cardLines) {
        // Remove "שלחה/שלח לך בקשת חברות" suffix if present
        let cleanLine = line
          .replace(/\s*שלח[הו]?\s*לך\s*בקשת\s*חברות\.?/g, '')
          .replace(/\s*sent\s*(you\s*)?a?\s*membership\s*request\.?/gi, '')
          .trim();
        
        // Check if this looks like a name
        if (cleanLine.length >= 2 && cleanLine.length <= 50 &&
            !cleanLine.includes('@') && 
            !/\d{4,}/.test(cleanLine) &&
            !cleanLine.includes('בקשות') &&
            !cleanLine.includes('חברים') &&
            !cleanLine.includes('קבוצות') &&
            !cleanLine.includes('הצטרפות') &&
            !cleanLine.includes('לפני') &&
            !cleanLine.includes('מסכים') &&
            !cleanLine.includes('אשר') &&
            !cleanLine.includes('דחה') &&
            !cleanLine.includes('סננים') &&
            !cleanLine.includes('שאלות') &&
            !cleanLine.includes('ניקוי') &&
            !cleanLine.includes('החדשות') &&
            !cleanLine.includes('מידע') &&
            !cleanLine.includes('כדי') &&
            !cleanLine.includes('אנחנו') &&
            !cleanLine.includes('יש לנו') &&
            !cleanLine.includes('השאירו') &&
            !cleanLine.includes('רלוונטי') &&
            !cleanLine.includes('עדכונים') &&
            !cleanLine.includes('מפיצים') &&
            !cleanLine.includes('כללי') &&
            !cleanLine.includes('תשובה') &&
            !cleanLine.includes('Facebook') &&
            !cleanLine.includes('אין תשובה') &&
            !cleanLine.includes('משותפ') &&
            !cleanLine.includes('נוספות') &&
            cleanLine !== 'לא נקרא') {
          // Extra check: names typically have 1-4 words
          const words = cleanLine.split(/\s+/);
          if (words.length >= 1 && words.length <= 5) {
            name = cleanLine;
            break;
          }
        }
      }
      
      if (!name || seen.has(name)) return;
      
      seen.add(name);
      results.push({ name, email, phone, date: today });
      console.log(`[FBCollector] ✅ ${name} | ${email} | ${phone}`);
    });

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
      alert('לא נמצאו בקשות.\n\nפתח Console (F12 → Console) וחפש [FBCollector] לפרטי debug.');
      return;
    }

    showModal(data);
  });

  console.log('[FB Group Collector] Loaded ✓ — v3');
})();
