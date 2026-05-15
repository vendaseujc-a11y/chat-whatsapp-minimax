const products = [
  {
    id: 1,
    name: "Whey Protein Concentrado 900g",
    description: "Proteína de soro do leite - 25g de proteína por dose. Sabor baunilha.",
    price: 189.90,
    category: "Proteínas",
    image: "💪",
    promo: true
  },
  {
    id: 2,
    name: "Creatina Monoidratada 300g",
    description: "Aumenta força e desempenho. 5g por dose. Sem sabor.",
    price: 89.90,
    category: "Creatina",
    image: "⚡"
  },
  {
    id: 3,
    name: "BCAA 240 capsules",
    description: "Aminoácidos de cadeia ramificada. Recuperação muscular pós-treino.",
    price: 79.90,
    category: "Aminoácidos",
    image: "🏋️"
  },
  {
    id: 4,
    name: "Pré-Treino 300g",
    description: "Energia e foco para seus treinos. Sabor frutas vermelhas.",
    price: 129.90,
    category: "Pré-Treino",
    image: "🔥"
  },
  {
    id: 5,
    name: "Glutamina 150g",
    description: "Recuperação e sistema imunológico. Pó solúvel.",
    price: 69.90,
    category: "Aminoácidos",
    image: "💊"
  },
  {
    id: 6,
    name: "Omega 3 90 caps",
    description: "Ácidos graxos essenciais. Saúde cardiovascular e cerebral.",
    price: 59.90,
    category: "Vitaminas",
    image: "🐟"
  },
  {
    id: 7,
    name: "Vitamina D3 60 caps",
    description: "6000 UI - Fortalecimento ósseo e imunidade.",
    price: 49.90,
    category: "Vitaminas",
    image: "☀️"
  },
  {
    id: 8,
    name: "Multivitaminico 60 caps",
    description: "Complexo vitamínico completo para dia a dia.",
    price: 54.90,
    category: "Vitaminas",
    image: "🌿"
  },
  {
    id: 9,
    name: "Albumina 400g",
    description: "Proteína de ovo. Ótima para complementar питание.",
    price: 79.90,
    category: "Proteínas",
    image: "🥚"
  },
  {
    id: 10,
    name: "Termogênico 60 caps",
    description: "Acelera metabolismo e queima gordura. Com cafeína natural.",
    price: 89.90,
    category: "Emagrecimento",
    image: "⚖️"
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