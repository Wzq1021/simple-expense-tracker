const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY,
        amount REAL NOT NULL,
        category TEXT NOT NULL,
        date TEXT NOT NULL,
        note TEXT,
        created_at INTEGER DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER)
      )
    `);
    console.log('Database initialized');
  } catch (error) {
    console.error('Failed to initialize database:', error);
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));

app.get('/api/expenses', async (req, res) => {
  const { start, end } = req.query;
  
  let sql = 'SELECT * FROM expenses';
  const params = [];
  
  if (start || end) {
    sql += ' WHERE ';
    const conditions = [];
    if (start) {
      conditions.push('date >= $1');
      params.push(start);
    }
    if (end) {
      conditions.push('date <= $' + (params.length + 1));
      params.push(end);
    }
    sql += conditions.join(' AND ');
  }
  
  sql += ' ORDER BY date DESC, created_at DESC';
  
  try {
    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching expenses:', error);
    res.status(500).json({ error: '获取数据失败' });
  }
});

app.post('/api/expenses', async (req, res) => {
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
  
  try {
    const result = await pool.query(
      'INSERT INTO expenses (id, amount, category, date, note) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [id, parseFloat(amount), category, date, note || '']
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error inserting expense:', error);
    res.status(500).json({ error: '保存失败' });
  }
});

app.delete('/api/expenses/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pool.query('DELETE FROM expenses WHERE id = $1', [id]);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: '记录不存在' });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting expense:', error);
    res.status(500).json({ error: '删除失败' });
  }
});

app.get('/api/debug', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM expenses ORDER BY date DESC, created_at DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching debug data:', error);
    res.status(500).json({ error: '获取数据失败' });
  }
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