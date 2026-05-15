const products = [
  {
    id: 1,
    name: "Promo do Dia - Combo Família",
    description: "Hambúrguer + batata frita + refrigerante 2L + onion rings",
    price: 49.90,
    category: "Lanches",
    image: "🍔",
    promo: true
  },
  {
    id: 2,
    name: "Hambúrguer Artesanal",
    description: "Pão brioche, carne bovina, queijo cheddar, alface, tomate e molho especial",
    price: 24.90,
    category: "Lanches",
    image: "🍔"
  },
  {
    id: 3,
    name: "Pizza Média (4 sabores)",
    description: "Massa italiana tradicional com ingredientes frescos",
    price: 59.90,
    category: "Pizzas",
    image: "🍕"
  },
  {
    id: 4,
    name: "Açaí 700ml",
    description: "Açaí natural com granola, morango, banana e mel",
    price: 18.90,
    category: "Sobremesas",
    image: "🍨"
  },
  {
    id: 5,
    name: "Suco Natural (700ml)",
    description: "Laranja, manga, abacaxi ou laranja com cenoura",
    price: 12.90,
    category: "Bebidas",
    image: "🧃"
  },
  {
    id: 6,
    name: "Cerveja Artesanal",
    description: "IPA, Pilsen ou Stout - Copo 400ml",
    price: 16.90,
    category: "Bebidas",
    image: "🍺"
  },
  {
    id: 7,
    name: "Prato do Dia - Feijoada",
    description: "Feijoada completa com arroz, couve, bacon e laranja",
    price: 32.90,
    category: "Pratos",
    image: "🍖"
  },
  {
    id: 8,
    name: "Sobremesa do Chef",
    description: "Brownie com sorvete e calda de chocolate",
    price: 15.90,
    category: "Sobremesas",
    image: "🍰"
  }
];

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