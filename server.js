const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const db = new sqlite3.Database('./expenses.db', (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
  } else {
    console.log('Connected to SQLite database');
  }
});

db.run(`
  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    amount REAL NOT NULL,
    category TEXT NOT NULL,
    date TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )
`);

app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));

app.get('/api/expenses', (req, res) => {
  db.all('SELECT * FROM expenses ORDER BY date DESC, created_at DESC', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.post('/api/expenses', (req, res) => {
  const { amount, category, date } = req.body;
  
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
  db.run('INSERT INTO expenses (id, amount, category, date) VALUES (?, ?, ?, ?)', 
    [id, parseFloat(amount), category, date], 
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      const newExpense = { id, amount: parseFloat(amount), category, date };
      res.status(201).json(newExpense);
    }
  );
});

app.delete('/api/expenses/:id', (req, res) => {
  const { id } = req.params;
  
  db.run('DELETE FROM expenses WHERE id = ?', [id], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (this.changes === 0) {
      return res.status(404).json({ error: '记录不存在' });
    }
    
    res.json({ success: true });
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});