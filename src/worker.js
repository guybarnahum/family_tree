export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/nodes')) {
      try {
        if (!env.DB) return new Response("DB binding missing", { status: 500 });
        const pathParts = url.pathname.split('/').filter(Boolean);
        const nodeId = pathParts[2];
        
        if (request.method === 'GET') {
          const { results } = await env.DB.prepare("SELECT * FROM nodes ORDER BY id ASC").all();
          return Response.json(results);
        }
        
        if (request.method === 'POST') {
          const data = await request.json();
          await env.DB.prepare(
            "INSERT INTO nodes (id, parent_id, spouse_id, name, dates, description) VALUES (?, ?, ?, ?, ?, ?)"
          ).bind(data.id, data.parent_id || null, data.spouse_id || null, data.name || 'שם', data.dates || 'תאריכים', data.description || 'תיאור').run();
          return Response.json({ success: true });
        }
        
        if (request.method === 'PATCH' && nodeId) {
          const data = await request.json();
          const field = Object.keys(data)[0]; 
          if (['name', 'dates', 'description', 'parent_id', 'spouse_id'].includes(field)) {
            await env.DB.prepare(`UPDATE nodes SET ${field} = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?`).bind(data[field], nodeId).run();
          }
          return Response.json({ success: true });
        }

        // NEW: Handle Deletion and safely unlink orphans/widows
        if (request.method === 'DELETE' && nodeId) {
          await env.DB.prepare("UPDATE nodes SET parent_id = NULL WHERE parent_id = ?").bind(nodeId).run();
          await env.DB.prepare("UPDATE nodes SET spouse_id = NULL WHERE spouse_id = ?").bind(nodeId).run();
          await env.DB.prepare("DELETE FROM nodes WHERE id = ?").bind(nodeId).run();
          return Response.json({ success: true });
        }
        
        return new Response("Method not allowed", { status: 405 });
      } catch (err) {
        return new Response(`API Error: ${err.message}`, { status: 500 });
      }
    }
    return env.ASSETS.fetch(request);
  }
};

async function handleApiRequest(request, env) {
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/').filter(Boolean);
  const nodeId = pathParts[2]; // /api/nodes/:id

  if (request.method === 'GET') {
    const { results } = await env.DB.prepare("SELECT * FROM nodes ORDER BY last_updated ASC").all();
    return new Response(JSON.stringify(results), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (request.method === 'POST') {
    const data = await request.json();
    await env.DB.prepare(
      "INSERT INTO nodes (id, parent_id, name, dates, description) VALUES (?, ?, ?, ?, ?)"
    ).bind(data.id, data.parent_id, data.name, data.dates, data.description).run();
    return new Response(JSON.stringify({ success: true }));
  }

  if (request.method === 'PATCH' && nodeId) {
    const data = await request.json();
    const field = Object.keys(data)[0]; 
    const value = data[field];
    
    // Whitelist fields to prevent SQL injection
    if (['name', 'dates', 'description', 'parent_id'].includes(field)) {
      await env.DB.prepare(
        `UPDATE nodes SET ${field} = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(value, nodeId).run();
    }
    return new Response(JSON.stringify({ success: true }));
  }

  return new Response("Method not allowed", { status: 405 });
}
