const express = require('express');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({ dest: '/tmp/' });

let db = {
  accounts: [
    { id: 'wechat', name: '微信', icon: '💬', created_at: Date.now() },
    { id: 'alipay', name: '支付宝', icon: '📱', created_at: Date.now() },
    { id: 'card', name: '银行卡', icon: '💳', created_at: Date.now() },
    { id: 'cash', name: '现金', icon: '💵', created_at: Date.now() },
    { id: 'other', name: '其他', icon: '📦', created_at: Date.now() }
  ],
  expenses: []
};

let usePostgres = false;
let pool = null;

if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });
  usePostgres = true;
}

async function initDB() {
  if (!usePostgres) {
    console.log('Using in-memory database for development');
    return;
  }

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

    console.log('PostgreSQL database initialized');
  } catch (error) {
    console.error('Failed to initialize PostgreSQL:', error);
    usePostgres = false;
    console.log('Falling back to in-memory database');
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));

app.get('/api/accounts', async (req, res) => {
  if (usePostgres) {
    try {
      const result = await pool.query('SELECT * FROM accounts ORDER BY created_at ASC');
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching accounts:', error);
      res.status(500).json({ error: '获取账户失败' });
    }
  } else {
    res.json(db.accounts);
  }
});

app.post('/api/accounts', async (req, res) => {
  const { name, icon } = req.body;

  if (!name) {
    return res.status(400).json({ error: '请输入账户名称' });
  }

  const id = Date.now().toString();
  const newAccount = { id, name, icon: icon || '💰', created_at: Date.now() };

  if (usePostgres) {
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
  } else {
    db.accounts.push(newAccount);
    res.status(201).json(newAccount);
  }
});

app.get('/api/expenses', async (req, res) => {
  const { start, end, type } = req.query;

  if (usePostgres) {
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
  } else {
    let filtered = db.expenses;
    if (start) filtered = filtered.filter(e => e.date >= start);
    if (end) filtered = filtered.filter(e => e.date <= end);
    if (type) filtered = filtered.filter(e => e.type === type);
    filtered.sort((a, b) => new Date(b.date) - new Date(a.date) || b.created_at - a.created_at);
    res.json(filtered);
  }
});

app.get('/api/expenses/:id', async (req, res) => {
  const { id } = req.params;

  if (usePostgres) {
    try {
      const result = await pool.query('SELECT * FROM expenses WHERE id = $1', [id]);
      if (result.rowCount === 0) {
        return res.status(404).json({ error: '记录不存在' });
      }
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error fetching expense:', error);
      res.status(500).json({ error: '获取数据失败' });
    }
  } else {
    const expense = db.expenses.find(e => e.id === id);
    if (!expense) {
      return res.status(404).json({ error: '记录不存在' });
    }
    res.json(expense);
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
  const newExpense = { id, type: recordType, amount: parseFloat(amount), category, account: account || '', to_account: to_account || '', date, note: note || '', created_at: Date.now() };

  if (usePostgres) {
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
  } else {
    db.expenses.push(newExpense);
    res.status(201).json(newExpense);
  }
});

app.put('/api/expenses/:id', async (req, res) => {
  const { id } = req.params;
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

  if (usePostgres) {
    try {
      const result = await pool.query(
        'UPDATE expenses SET type = $1, amount = $2, category = $3, account = $4, to_account = $5, date = $6, note = $7 WHERE id = $8 RETURNING *',
        [type || 'expense', parseFloat(amount), category, account || '', to_account || '', date, note || '', id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: '记录不存在' });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error updating expense:', error);
      res.status(500).json({ error: '更新失败' });
    }
  } else {
    const index = db.expenses.findIndex(e => e.id === id);
    if (index === -1) {
      return res.status(404).json({ error: '记录不存在' });
    }

    db.expenses[index] = {
      ...db.expenses[index],
      type: type || 'expense',
      amount: parseFloat(amount),
      category,
      account: account || '',
      to_account: to_account || '',
      date,
      note: note || ''
    };

    res.json(db.expenses[index]);
  }
});

app.delete('/api/expenses/:id', async (req, res) => {
  const { id } = req.params;

  if (usePostgres) {
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
  } else {
    const index = db.expenses.findIndex(e => e.id === id);
    if (index === -1) {
      return res.status(404).json({ error: '记录不存在' });
    }
    db.expenses.splice(index, 1);
    res.json({ success: true });
  }
});

app.get('/api/stats', async (req, res) => {
  const { start, end } = req.query;

  if (usePostgres) {
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
  } else {
    let filtered = db.expenses;
    if (start) filtered = filtered.filter(e => e.date >= start);
    if (end) filtered = filtered.filter(e => e.date <= end);
    const income = filtered.filter(e => e.type === 'income').reduce((sum, e) => sum + e.amount, 0);
    const expense = filtered.filter(e => e.type === 'expense').reduce((sum, e) => sum + e.amount, 0);
    const transfer = filtered.filter(e => e.type === 'transfer').reduce((sum, e) => sum + e.amount, 0);
    res.json({ income, expense, transfer });
  }
});

app.get('/api/account-balances', async (req, res) => {
  if (usePostgres) {
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
  } else {
    const balances = {};
    db.accounts.forEach(acc => {
      balances[acc.id] = { name: acc.name, icon: acc.icon, balance: 0 };
    });

    db.expenses.forEach(e => {
      if (e.type === 'income' && e.account && balances[e.account]) {
        balances[e.account].balance += e.amount;
      }
      if (e.type === 'expense' && e.account && balances[e.account]) {
        balances[e.account].balance -= e.amount;
      }
      if (e.type === 'transfer') {
        if (e.account && balances[e.account]) balances[e.account].balance -= e.amount;
        if (e.to_account && balances[e.to_account]) balances[e.to_account].balance += e.amount;
      }
    });

    const totalBalance = Object.values(balances).reduce((sum, acc) => sum + acc.balance, 0);
    res.json({ accounts: Object.values(balances), totalBalance });
  }
});

app.get('/api/debug', async (req, res) => {
  if (usePostgres) {
    try {
      const result = await pool.query('SELECT * FROM expenses ORDER BY date DESC, created_at DESC');
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching debug data:', error);
      res.status(500).json({ error: '获取数据失败' });
    }
  } else {
    const filtered = [...db.expenses].sort((a, b) => new Date(b.date) - new Date(a.date) || b.created_at - a.created_at);
    res.json(filtered);
  }
});

app.post('/api/voice', upload.single('audio'), async (req, res) => {
  const fs = require('fs');

  if (!req.file) {
    return res.status(400).json({ error: '未收到音频文件' });
  }

  const openaiApiKey = process.env.OPENAI_API_KEY;

  if (!openaiApiKey) {
    console.log('未配置OpenAI API Key，使用模拟模式');
    const mockTexts = [
      '今天中午吃饭吃的老乡鸡花了19块钱',
      '昨天打车花了35块',
      '工资收入5000元',
      '今天买衣服花了200元',
      '昨天晚上看电影花了80块'
    ];
    const randomText = mockTexts[Math.floor(Math.random() * mockTexts.length)];
    setTimeout(() => {
      fs.unlinkSync(req.file.path);
      res.json({ text: randomText });
    }, 500);
    return;
  }

  try {
    const audioStream = fs.createReadStream(req.file.path);
    
    const formData = new (require('form-data'))();
    formData.append('file', audioStream, { filename: 'voice.webm', contentType: 'audio/webm' });
    formData.append('model', 'whisper-1');
    formData.append('language', 'zh');
    formData.append('response_format', 'json');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        ...formData.getHeaders()
      },
      body: formData
    });

    fs.unlinkSync(req.file.path);

    if (!response.ok) {
      const errorData = await response.json();
      console.error('OpenAI API错误:', errorData);
      return res.status(response.status).json({ error: errorData.error?.message || '语音识别失败' });
    }

    const result = await response.json();
    res.json({ text: result.text });

  } catch (error) {
    console.error('语音识别错误:', error);
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: '语音识别服务异常' });
  }
});

app.post('/api/parse-text', async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: '请输入文本' });
  }

  const openaiApiKey = process.env.OPENAI_API_KEY;

  if (!openaiApiKey) {
    console.log('未配置OpenAI API Key，使用正则解析');
    const result = parseTextWithRegex(text);
    return res.json({ success: true, data: result });
  }

  try {
    const systemPrompt = `你是一个智能记账助手，需要从用户的语音文本中提取结构化的记账信息。

支出分类：餐饮、交通、购物、娱乐、居住、医疗、教育、其他
收入分类：工资、奖金、理财、其他
转账：从一个账户转到另一个账户

请分析以下文本，提取以下字段：
- type: expense（支出）、income（收入）、transfer（转账），默认expense
- amount: 金额（数字），必须提取
- category: 分类，从上面的分类中选择最合适的
- date: 日期，格式YYYY-MM-DD，如"今天"则为今天，"昨天"则为昨天，"前天"则为前天，没有提到日期则为今天
- note: 备注，提取有用的描述信息（如商家名称、具体物品等）
- account: 账户（可选，如支付宝、微信、银行卡等）
- to_account: 转账目标账户（仅transfer类型需要）

请返回严格的JSON格式，不要包含其他内容。

示例：
输入："今天中午吃饭吃的老乡鸡花了19块钱"
输出：{"type":"expense","amount":19,"category":"餐饮","date":"2026-07-16","note":"老乡鸡"}

输入："工资收入5000元"
输出：{"type":"income","amount":5000,"category":"工资","date":"2026-07-16","note":"工资"}

输入："从微信转500块到银行卡"
输出：{"type":"transfer","amount":500,"category":"转账","date":"2026-07-16","note":"","account":"微信","to_account":"银行卡"}

输入："昨天打车花了35块"
输出：{"type":"expense","amount":35,"category":"交通","date":"2026-07-15","note":"打车"}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        temperature: 0,
        max_tokens: 200
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('OpenAI API错误:', errorData);
      const fallbackResult = parseTextWithRegex(text);
      return res.json({ success: true, data: fallbackResult });
    }

    const result = await response.json();
    const jsonStr = result.choices[0].message.content.replace(/```json|```/g, '').trim();
    
    try {
      const parsedData = JSON.parse(jsonStr);
      res.json({ success: true, data: parsedData });
    } catch (e) {
      console.error('JSON解析失败:', jsonStr);
      const fallbackResult = parseTextWithRegex(text);
      res.json({ success: true, data: fallbackResult });
    }

  } catch (error) {
    console.error('文本解析错误:', error);
    const fallbackResult = parseTextWithRegex(text);
    res.json({ success: true, data: fallbackResult });
  }
});

function parseTextWithRegex(text) {
  const result = {
    type: 'expense',
    amount: '',
    category: '',
    date: '',
    note: '',
    account: '',
    to_account: ''
  };

  const today = new Date();
  const formatDate = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  if (text.includes('今天') || text.includes('今日') || !text.match(/(昨天|前天|明天|上周|上月|\d{1,2}月\d{1,2}日|\d{4}-\d{2}-\d{2})/)) {
    result.date = formatDate(today);
  } else if (text.includes('昨天')) {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    result.date = formatDate(yesterday);
  } else if (text.includes('前天')) {
    const dayBefore = new Date(today);
    dayBefore.setDate(dayBefore.getDate() - 2);
    result.date = formatDate(dayBefore);
  }

  const cnNumMap = { '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '百': 100, '千': 1000 };
  const cnNumRegex = /([零一二三四五六七八九十百千]+)(块|元|块钱|元钱|块儿)?/g;
  
  let cnMatch;
  while ((cnMatch = cnNumRegex.exec(text)) !== null) {
    const cnNum = cnMatch[1];
    let num = 0;
    let temp = 0;
    
    for (let i = 0; i < cnNum.length; i++) {
      const char = cnNum[i];
      if (char === '十') {
        temp = temp === 0 ? 10 : temp * 10;
        num += temp;
        temp = 0;
      } else if (char === '百') {
        temp = temp === 0 ? 100 : temp * 100;
        num += temp;
        temp = 0;
      } else if (char === '千') {
        temp = temp === 0 ? 1000 : temp * 1000;
        num += temp;
        temp = 0;
      } else {
        temp = cnNumMap[char];
      }
    }
    num += temp;
    
    if (num > 0 && num <= 100000) {
      result.amount = num;
      break;
    }
  }

  if (!result.amount) {
    const numMatch = text.match(/(\d+(?:\.\d+)?)\s*(块|元|块钱|元钱|块儿)/);
    if (numMatch) {
      result.amount = parseFloat(numMatch[1]);
    }
  }

  if (text.includes('收入') || text.includes('工资') || text.includes('奖金') || text.includes('理财') || text.includes('利息')) {
    result.type = 'income';
    if (!result.category) {
      if (text.includes('工资')) result.category = '工资';
      else if (text.includes('奖金')) result.category = '奖金';
      else if (text.includes('理财') || text.includes('利息')) result.category = '理财';
      else result.category = '其他';
    }
  } else if (text.includes('转') && text.includes('到')) {
    result.type = 'transfer';
    result.category = '转账';
    const transferMatch = text.match(/(从|用)(.+?)(转)/);
    if (transferMatch) result.account = transferMatch[2].trim();
    const toMatch = text.match(/(到)(.+?)(块|元|$)/);
    if (toMatch) result.to_account = toMatch[2].trim();
  } else {
    result.type = 'expense';
    if (!result.category) {
      if (text.includes('吃') || text.includes('饭') || text.includes('餐') || text.includes('菜') || text.includes('老乡鸡')) result.category = '餐饮';
      else if (text.includes('车') || text.includes('打车') || text.includes('滴滴') || text.includes('公交') || text.includes('地铁') || text.includes('加油')) result.category = '交通';
      else if (text.includes('买') || text.includes('购物') || text.includes('衣服') || text.includes('鞋') || text.includes('超市')) result.category = '购物';
      else if (text.includes('电影') || text.includes('玩') || text.includes('娱乐') || text.includes('KTV') || text.includes('游戏')) result.category = '娱乐';
      else if (text.includes('房租') || text.includes('水电') || text.includes('物业')) result.category = '居住';
      else if (text.includes('医院') || text.includes('药') || text.includes('看病') || text.includes('体检')) result.category = '医疗';
      else if (text.includes('学') || text.includes('书') || text.includes('培训') || text.includes('教育')) result.category = '教育';
      else result.category = '其他';
    }
  }

  const categoryKeywords = ['餐饮', '交通', '购物', '娱乐', '居住', '医疗', '教育', '其他', '工资', '奖金', '理财', '转账'];
  const dateKeywords = ['今天', '昨天', '前天', '明天', '上周', '上月'];
  let noteText = text;
  
  if (result.amount) {
    noteText = noteText.replace(new RegExp(`(${result.amount})(块|元|块钱|元钱)?`, 'g'), '');
  }
  categoryKeywords.forEach(kw => {
    noteText = noteText.replace(new RegExp(kw, 'g'), '');
  });
  dateKeywords.forEach(kw => {
    noteText = noteText.replace(new RegExp(kw, 'g'), '');
  });
  noteText = noteText.replace(/(收入|支出|花了|花|转|到|从|用)/g, '');
  noteText = noteText.replace(/\s+/g, '').trim();
  
  if (noteText.length > 0) {
    result.note = noteText;
  }

  return result;
}

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});