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
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT DEFAULT '💰',
        created_at INTEGER DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY,
        type TEXT DEFAULT 'expense',
        amount REAL NOT NULL,
        category TEXT NOT NULL,
        account TEXT,
        to_account TEXT,
        date TEXT NOT NULL,
        note TEXT,
        created_at INTEGER DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER)
      )
    `);

    const accountsResult = await pool.query('SELECT COUNT(*) FROM accounts');
    if (parseInt(accountsResult.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO accounts (id, name, icon) VALUES
        ('wechat', '微信', '💬'),
        ('alipay', '支付宝', '📱'),
        ('card', '银行卡', '💳'),
        ('cash', '现金', '💵'),
        ('other', '其他', '📦')
      `);
    }

    const expensesResult = await pool.query('SELECT COUNT(*) FROM expenses WHERE type IS NULL');
    if (parseInt(expensesResult.rows[0].count) > 0) {
      await pool.query("UPDATE expenses SET type = 'expense' WHERE type IS NULL");
    }

    console.log('Database initialized');
  } catch (error) {
    console.error('Failed to initialize database:', error);
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));

app.get('/api/accounts', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM accounts ORDER BY created_at ASC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({ error: '获取账户失败' });
  }
});

app.post('/api/accounts', async (req, res) => {
  const { name, icon } = req.body;

  if (!name) {
    return res.status(400).json({ error: '请输入账户名称' });
  }

  const id = Date.now().toString();

  try {
    const result = await pool.query(
      'INSERT INTO accounts (id, name, icon) VALUES ($1, $2, $3) RETURNING *',
      [id, name, icon || '💰']
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error inserting account:', error);
    res.status(500).json({ error: '添加账户失败' });
  }
});

app.get('/api/expenses', async (req, res) => {
  const { start, end, type } = req.query;

  let sql = 'SELECT * FROM expenses';
  const params = [];

  if (start || end || type) {
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
    if (type) {
      conditions.push('type = $' + (params.length + 1));
      params.push(type);
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
  const { type, amount, category, account, to_account, date, note } = req.body;

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
  const recordType = type || 'expense';

  try {
    const result = await pool.query(
      'INSERT INTO expenses (id, type, amount, category, account, to_account, date, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [id, recordType, parseFloat(amount), category, account || '', to_account || '', date, note || '']
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

app.get('/api/stats', async (req, res) => {
  const { start, end } = req.query;

  let whereClause = '';
  const params = [];

  if (start || end) {
    whereClause = ' WHERE ';
    const conditions = [];
    if (start) {
      conditions.push('date >= $1');
      params.push(start);
    }
    if (end) {
      conditions.push('date <= $' + (params.length + 1));
      params.push(end);
    }
    whereClause += conditions.join(' AND ');
  }

  try {
    const incomeResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM expenses ${whereClause} AND type = 'income'`,
      params.map((p, i) => p)
    );

    const expenseResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM expenses ${whereClause} AND type = 'expense'`,
      params.map((p, i) => p)
    );

    const transferResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM expenses ${whereClause} AND type = 'transfer'`,
      params.map((p, i) => p)
    );

    res.json({
      income: parseFloat(incomeResult.rows[0].total),
      expense: parseFloat(expenseResult.rows[0].total),
      transfer: parseFloat(transferResult.rows[0].total)
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: '获取统计数据失败' });
  }
});

app.get('/api/account-balances', async (req, res) => {
  try {
    const incomeResult = await pool.query(`
      SELECT account, COALESCE(SUM(amount), 0) as total 
      FROM expenses 
      WHERE type = 'income' AND account IS NOT NULL AND account != ''
      GROUP BY account
    `);

    const expenseResult = await pool.query(`
      SELECT account, COALESCE(SUM(amount), 0) as total 
      FROM expenses 
      WHERE type = 'expense' AND account IS NOT NULL AND account != ''
      GROUP BY account
    `);

    const transferFromResult = await pool.query(`
      SELECT account, COALESCE(SUM(amount), 0) as total 
      FROM expenses 
      WHERE type = 'transfer' AND account IS NOT NULL AND account != ''
      GROUP BY account
    `);

    const transferToResult = await pool.query(`
      SELECT to_account as account, COALESCE(SUM(amount), 0) as total 
      FROM expenses 
      WHERE type = 'transfer' AND to_account IS NOT NULL AND to_account != ''
      GROUP BY to_account
    `);

    const accountsResult = await pool.query('SELECT * FROM accounts ORDER BY created_at ASC');
    const accounts = accountsResult.rows;

    const balances = {};
    accounts.forEach(acc => {
      balances[acc.id] = {
        name: acc.name,
        icon: acc.icon,
        balance: 0
      };
    });

    incomeResult.rows.forEach(row => {
      if (balances[row.account]) {
        balances[row.account].balance += parseFloat(row.total);
      }
    });

    expenseResult.rows.forEach(row => {
      if (balances[row.account]) {
        balances[row.account].balance -= parseFloat(row.total);
      }
    });

    transferFromResult.rows.forEach(row => {
      if (balances[row.account]) {
        balances[row.account].balance -= parseFloat(row.total);
      }
    });

    transferToResult.rows.forEach(row => {
      if (balances[row.account]) {
        balances[row.account].balance += parseFloat(row.total);
      }
    });

    const totalBalance = Object.values(balances).reduce((sum, acc) => sum + acc.balance, 0);

    res.json({
      accounts: Object.values(balances),
      totalBalance
    });
  } catch (error) {
    console.error('Error fetching account balances:', error);
    res.status(500).json({ error: '获取账户余额失败' });
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