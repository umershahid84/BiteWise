const express = require('express');
const { HttpError } = require('../errors');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// JSON API: document text for the accept/decline dialog.
function api({ legal }) {
  const router = express.Router();
  router.get('/required', (req, res) => {
    const role = req.query.role === 'restaurant' ? 'restaurant' : 'customer';
    res.json({ documents: legal.required(role).map((d) => legal.get(d.id)) });
  });
  router.get('/:doc', (req, res) => {
    const doc = legal.get(req.params.doc);
    if (!doc) throw new HttpError(404, 'Document not found.');
    res.json({ document: doc });
  });
  return router;
}

// Public, printable pages: /legal/customer-terms, /legal/restaurant-agreement, /legal/privacy
function pages({ legal }) {
  const router = express.Router();
  const nav = [['customer-terms', 'Customer Terms'], ['restaurant-agreement', 'Restaurant Partner Agreement'], ['privacy', 'Privacy Policy']];
  router.get('/:doc', (req, res, next) => {
    const doc = legal.get(req.params.doc);
    if (!doc) return next();
    res.type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.title)} · Bite Wise</title>
<meta name="theme-color" content="#07110d">
<link rel="icon" href="/assets/logo-mark.svg" type="image/svg+xml">
<link rel="stylesheet" href="/css/styles.css">
</head>
<body>
<header id="site-header" class="site-header no-print"></header>
<main class="page">
  <div class="container" style="max-width:860px">
    <div class="doc-toolbar no-print">
      ${nav.map(([id, label]) => `<a class="btn btn-sm ${id === doc.id ? 'btn-primary' : 'btn-ghost'}" href="/legal/${id}">${label}</a>`).join('')}
      <span class="spacer"></span>
      <button class="btn btn-ghost btn-sm" id="print-btn" type="button">🖨️ Print</button>
    </div>
    <article class="paper legal">
      <div class="p-head"><img src="/assets/logo.svg" alt="Bite Wise">
        <div class="p-title"><h1>${esc(doc.title)}</h1><div class="p-muted small">Effective ${esc(doc.effective)} · Version ${esc(doc.version)}</div></div></div>
      ${doc.html}
    </article>
  </div>
</main>
<script type="module" src="/js/legal-page.js"></script>
</body>
</html>`);
  });
  return router;
}

module.exports = { api, pages };
