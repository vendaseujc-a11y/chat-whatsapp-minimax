const fs = require('fs');
const path = require('path');

const jsonPath = path.join(__dirname, 'products.json');

// Helper to load products dynamically from JSON file
function loadProducts() {
  try {
    if (fs.existsSync(jsonPath)) {
      const data = fs.readFileSync(jsonPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Erro ao carregar produtos do JSON:', e);
  }
  
  // Fallback to static list if JSON is missing or corrupt
  return [
    {
      id: 1,
      name: "100% Whey Prime Integralmedica",
      category: "Proteínas",
      image: "💪",
      price: 139.90,
      promo: true,
      description: "Whey Protein concentrado de alta qualidade, ideal para ganho de massa muscular e recuperação pós-treino."
    },
    {
      id: 2,
      name: "Creatina Creapure Max Titanium",
      category: "Força",
      image: "⚡",
      price: 99.90,
      promo: false,
      description: "Creatina monohidratada 100% pura com selo Creapure, garantindo máxima absorção, força e explosão muscular."
    },
    {
      id: 3,
      name: "Whey Gold Standard Optimum Nutrition",
      category: "Proteínas",
      image: "⭐",
      price: 249.90,
      promo: true,
      description: "O Whey Protein isolado mais vendido do mundo. Elevada pureza proteica e sabor incomparável."
    },
    {
      id: 4,
      name: "Pré-Treino C4 Beta Pump Pro",
      category: "Energia",
      image: "🔥",
      price: 119.90,
      promo: false,
      description: "Pré-treino ultra concentrado para máximo foco, energia explosiva e vasodilatação durante os treinos mais intensos."
    },
    {
      id: 5,
      name: "BCAA Powder Max Titanium",
      category: "Recuperação",
      image: "💊",
      price: 79.90,
      promo: false,
      description: "Aminoácidos de cadeia ramificada essenciais para reduzir a fadiga muscular e acelerar a síntese proteica."
    }
  ];
}

// Helper to save products back to JSON file
function saveProducts(productsList) {
  try {
    fs.writeFileSync(jsonPath, JSON.stringify(productsList, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Erro ao salvar produtos no JSON:', e);
    return false;
  }
}

function getAllProducts() {
  return loadProducts();
}

function getProductById(id) {
  return loadProducts().find(p => p.id === id);
}

function getProductsByCategory(category) {
  return loadProducts().filter(p => p.category === category);
}

function getPromos() {
  return loadProducts().filter(p => p.promo);
}

function searchProducts(query) {
  const lowerQuery = query.toLowerCase();
  return loadProducts().filter(p => 
    p.name.toLowerCase().includes(lowerQuery) ||
    p.description.toLowerCase().includes(lowerQuery) ||
    p.category.toLowerCase().includes(lowerQuery)
  );
}

// Admin handler to add or update a product
function addOrUpdateProduct(productData) {
  const productsList = loadProducts();
  const index = productsList.findIndex(p => p.id === productData.id || (productData.name && p.name.toLowerCase() === productData.name.toLowerCase()));
  
  if (index !== -1) {
    // Update existing product
    const existing = productsList[index];
    productsList[index] = {
      ...existing,
      ...productData,
      price: parseFloat(productData.price) || existing.price,
      promo: typeof productData.promo === 'boolean' ? productData.promo : existing.promo
    };
  } else {
    // Add new product
    const nextId = productsList.length > 0 ? Math.max(...productsList.map(p => p.id)) + 1 : 1;
    productsList.push({
      id: nextId,
      name: productData.name,
      category: productData.category || 'Suplemento',
      image: productData.image || '💪',
      price: parseFloat(productData.price) || 0.0,
      promo: !!productData.promo,
      description: productData.description || ''
    });
  }
  
  return saveProducts(productsList);
}

// Admin handler to delete a product
function deleteProduct(id) {
  const productsList = loadProducts();
  const filtered = productsList.filter(p => p.id !== id);
  return saveProducts(filtered);
}

module.exports = {
  loadProducts,
  getAllProducts,
  getProductById,
  getProductsByCategory,
  getPromos,
  searchProducts,
  addOrUpdateProduct,
  deleteProduct
};