const express = require('express');
const cors = require('cors');
const path = require('path');
const authRouter = require('./routes/auth');
const apiRouter = require('./routes/api');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Better Auth and API Routes
app.use('/api/auth', authRouter);
app.use('/api', apiRouter);

// Fallback for SPA (if index.html handles routing)
app.get('*', (req, res) => {
    // Only handle if not an API route
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, HOST, () => {
        console.log(`🚀 AgendaGuru Modern Backend running at http://${HOST}:${PORT}`);
        console.log(`Using Database: ${process.env.TURSO_DATABASE_URL ? 'Turso DB' : 'Local SQLite'}`);
    });
}

module.exports = app;
