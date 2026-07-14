const express = require('express');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'expenses.db');

let db = null;

async function initDB() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  
  const SQL = await initSqlJs({
    locateFile: file => `node_modules/sql.js/dist/${file}`
  });
  
  if (fs.existsSync(DB_PATH)) {
    const data = fs.readFileSync(DB_PATH);
    db = new SQL.Database(new Uint8Array(data));
    console.log('Database loaded from file');
    
    try {
      db.run('ALTER TABLE expenses ADD COLUMN note TEXT');
      saveDB();
      console.log('Added note column to expenses table');
    } catch (e) {
      console.log('Note column already exists');
    }
  } else {
    db = new SQL.Database();
    db.run(`
      CREATE TABLE expenses (
        id TEXT PRIMARY KEY,
        amount REAL NOT NULL,
        category TEXT NOT NULL,
        date TEXT NOT NULL,
        note TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
    saveDB();
    console.log('New database created');
  }
}

function saveDB() {
  if (db) {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));

app.get('/api/expenses', (req, res) => {
  const { start, end } = req.query;
  
  let sql = 'SELECT * FROM expenses';
  const params = [];
  
  if (start || end) {
    sql += ' WHERE ';
    const conditions = [];
    if (start) {
      conditions.push('date >= ?');
      params.push(start);
    }
    if (end) {
      conditions.push('date <= ?');
      params.push(end);
    }
    sql += conditions.join(' AND ');
  }
  
  sql += ' ORDER BY date DESC, created_at DESC';
  
  const stmt = db.prepare(sql);
  const expenses = [];
  if (params.length > 0) {
    stmt.bind(params);
  }
  while (stmt.step()) {
    expenses.push(stmt.getAsObject());
  }
  stmt.free();
  res.json(expenses);
});

app.post('/api/expenses', (req, res) => {
  const { amount, category, date, note } = req.body;
  
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: '请输入有效的金额' });
  }
  
  if (!category) {
    return res.status(400).json({ error: '请选择分类' });
  }
  
  if (!date) {
    return res.status(400).json({ error: '请选择日期' });
  }
  
  const id = Date.now().toString();
  db.run('INSERT INTO expenses (id, amount, category, date, note) VALUES (?, ?, ?, ?, ?)', 
    [id, parseFloat(amount), category, date, note || '']
  );
  saveDB();
  
  const newExpense = { id, amount: parseFloat(amount), category, date, note: note || '' };
  res.status(201).json(newExpense);
});

app.delete('/api/expenses/:id', (req, res) => {
  const { id } = req.params;
  
  const stmt = db.prepare('DELETE FROM expenses WHERE id = ?');
  const result = stmt.run([id]);
  stmt.free();
  
  if (!result.changes) {
    return res.status(404).json({ error: '记录不存在' });
  }
  
  saveDB();
  res.json({ success: true });
});

app.get('/api/debug', (req, res) => {
  const stmt = db.prepare('SELECT * FROM expenses ORDER BY date DESC, created_at DESC');
  const expenses = [];
  while (stmt.step()) {
    expenses.push(stmt.getAsObject());
  }
  stmt.free();
  res.json(expenses);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});