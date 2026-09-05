export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/nodes')) {
      return env.ASSETS.fetch(request);
    }

    try {
      if (!env.DB) {
        return new Response('DB binding missing', { status: 500 });
      }

      const pathParts = url.pathname.split('/').filter(Boolean);
      const nodeId = pathParts[2];

      if (request.method === 'GET') {
        const { results } = await env.DB
          .prepare('SELECT * FROM nodes ORDER BY id ASC')
          .all();

        return Response.json(results, {
          headers: { 'Cache-Control': 'no-store' }
        });
      }

      if (request.method === 'POST') {
        const data = await request.json();
        if (!data.id) {
          return new Response('Node id is required', { status: 400 });
        }

        await env.DB.prepare(
          'INSERT INTO nodes (id, parent_id, spouse_id, name, dates, description) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(
          data.id,
          data.parent_id || null,
          data.spouse_id || null,
          data.name || 'שם',
          data.dates || 'תאריכים',
          data.description || 'תיאור'
        ).run();

        return Response.json({ success: true });
      }

      if (request.method === 'PATCH' && nodeId) {
        const data = await request.json();
        const fields = Object.keys(data);
        if (fields.length !== 1) {
          return new Response('PATCH expects exactly one field', { status: 400 });
        }

        const field = fields[0];
        const allowedFields = ['name', 'dates', 'description', 'parent_id', 'spouse_id'];
        if (!allowedFields.includes(field)) {
          return new Response('Unsupported field', { status: 400 });
        }

        await env.DB.prepare(
          `UPDATE nodes SET ${field} = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?`
        ).bind(data[field], nodeId).run();

        return Response.json({ success: true });
      }

      if (request.method === 'DELETE' && nodeId) {
        await env.DB.batch([
          env.DB.prepare('UPDATE nodes SET parent_id = NULL WHERE parent_id = ?').bind(nodeId),
          env.DB.prepare('UPDATE nodes SET spouse_id = NULL WHERE spouse_id = ?').bind(nodeId),
          env.DB.prepare('DELETE FROM nodes WHERE id = ?').bind(nodeId)
        ]);

        return Response.json({ success: true });
      }

      return new Response('Method not allowed', { status: 405 });
    } catch (err) {
      return new Response(`API Error: ${err.message}`, { status: 500 });
    }
  }
};
