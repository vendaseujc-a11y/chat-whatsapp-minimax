const axios = require('axios');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yfqefcpbawhpqnplqiio.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';

const supaHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

async function supaFetch(method, path, data, extra) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  try {
    const res = await axios({ method, url, data, headers: { ...supaHeaders, ...extra } });
    return res.data;
  } catch (e) {
    console.error(`Supabase products ${method.toUpperCase()} ${path} error:`, e.response ? JSON.stringify(e.response.data) : e.message);
    return null;
  }
}

function formatProduct(p) {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    image: p.image,
    price: parseFloat(p.price),
    promo: p.promo,
    description: p.description,
    stock: p.stock !== undefined ? p.stock : 10,
    tenantId: p.tenant_id
  };
}

async function getAllProducts(tenantId = 1) {
  tenantId = parseInt(tenantId) || 1;
  const rows = await supaFetch('get', `products?tenant_id=eq.${tenantId}&select=*&order=id.asc`);
  if (!rows) return [];
  return rows.map(formatProduct);
}

async function getProductById(id, tenantId = 1) {
  tenantId = parseInt(tenantId) || 1;
  id = parseInt(id);
  const rows = await supaFetch('get', `products?id=eq.${id}&tenant_id=eq.${tenantId}&select=*&limit=1`);
  if (!rows || rows.length === 0) return null;
  return formatProduct(rows[0]);
}

async function getProductsByCategory(category, tenantId = 1) {
  tenantId = parseInt(tenantId) || 1;
  const encoded = encodeURIComponent(category);
  const rows = await supaFetch('get', `products?tenant_id=eq.${tenantId}&category=ilike.${encoded}&select=*`);
  if (!rows) return [];
  return rows.map(formatProduct);
}

async function getPromos(tenantId = 1) {
  tenantId = parseInt(tenantId) || 1;
  const rows = await supaFetch('get', `products?tenant_id=eq.${tenantId}&promo=eq.true&select=*`);
  if (!rows) return [];
  return rows.map(formatProduct);
}

async function searchProducts(query, tenantId = 1) {
  tenantId = parseInt(tenantId) || 1;
  const encoded = encodeURIComponent(`%${query}%`);
  const rows = await supaFetch('get',
    `products?tenant_id=eq.${tenantId}&or=(name.ilike.${encoded},category.ilike.${encoded},description.ilike.${encoded})&select=*`
  );
  if (!rows) return [];
  return rows.map(formatProduct);
}

async function addOrUpdateProduct(productData, tenantId = 1) {
  tenantId = parseInt(tenantId) || 1;
  const stockVal = productData.stock !== undefined ? parseInt(productData.stock) : 10;
  const existingId = parseInt(productData.id);

  const payload = {
    tenant_id: tenantId,
    name: productData.name,
    category: productData.category || 'Produto',
    image: productData.image || '📦',
    price: parseFloat(productData.price) || 0.0,
    promo: typeof productData.promo === 'boolean' ? productData.promo : !!productData.promo,
    description: productData.description || '',
    stock: stockVal
  };

  if (existingId) {
    // Check if product exists
    const existing = await supaFetch('get', `products?id=eq.${existingId}&tenant_id=eq.${tenantId}&select=id&limit=1`);
    if (existing && existing.length > 0) {
      const result = await supaFetch('patch', `products?id=eq.${existingId}&tenant_id=eq.${tenantId}`, payload);
      return result !== null;
    }
  }

  // Insert new
  const result = await supaFetch('post', 'products', payload);
  return result !== null;
}

async function deleteProduct(id, tenantId = 1) {
  tenantId = parseInt(tenantId) || 1;
  id = parseInt(id);
  const result = await supaFetch('delete', `products?id=eq.${id}&tenant_id=eq.${tenantId}`);
  return true;
}

module.exports = {
  getAllProducts,
  getProductById,
  getProductsByCategory,
  getPromos,
  searchProducts,
  addOrUpdateProduct,
  deleteProduct
};