const products = [];

function getAllProducts() {
  return products;
}

function getProductById(id) {
  return products.find(p => p.id === id);
}

function getProductsByCategory(category) {
  return products.filter(p => p.category === category);
}

function getPromos() {
  return products.filter(p => p.promo);
}

function searchProducts(query) {
  const lowerQuery = query.toLowerCase();
  return products.filter(p => 
    p.name.toLowerCase().includes(lowerQuery) ||
    p.description.toLowerCase().includes(lowerQuery) ||
    p.category.toLowerCase().includes(lowerQuery)
  );
}

module.exports = {
  products,
  getAllProducts,
  getProductById,
  getProductsByCategory,
  getPromos,
  searchProducts
};