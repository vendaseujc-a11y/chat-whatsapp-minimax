const axios = require('axios');

const TENANTS_OBJ_ID = 'ff8081819d82fab6019f05e1d40b67da';
const PRODUCTS_OBJ_ID = 'ff8081819d82fab6019f05e1d5c767db';

const TENANTS_KEY = 'tenants';
const PRODUCTS_KEY = 'products';

async function saveToKv(key, data) {
  const objId = key === TENANTS_KEY ? TENANTS_OBJ_ID : PRODUCTS_OBJ_ID;
  const name = key === TENANTS_KEY ? 'VCF_SaaS_Tenants_Prod' : 'VCF_SaaS_Products_Prod';
  
  try {
    await axios.put(`https://api.restful-api.dev/objects/${objId}`, {
      name,
      data: { list: data }
    }, {
      headers: { 'Content-Type': 'application/json' }
    });
    console.log(`Saved key "${key}" to cloud KV successfully.`);
  } catch (error) {
    console.error(`Error saving key "${key}" to cloud KV:`, error.message);
  }
}

async function loadFromKv(key) {
  const objId = key === TENANTS_KEY ? TENANTS_OBJ_ID : PRODUCTS_OBJ_ID;
  
  try {
    const res = await axios.get(`https://api.restful-api.dev/objects/${objId}`);
    if (res.data && res.data.data && Array.isArray(res.data.data.list)) {
      return res.data.data.list;
    }
  } catch (error) {
    console.error(`Error loading key "${key}" from cloud KV:`, error.message);
  }
  return null;
}

module.exports = {
  saveToKv,
  loadFromKv,
  TENANTS_KEY,
  PRODUCTS_KEY
};
