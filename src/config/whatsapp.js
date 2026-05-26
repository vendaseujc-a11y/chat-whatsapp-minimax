const whatsappConfig = {
  phoneNumber: "17996705407",
  businessName: "VouComprarFácil",
  defaultMessage: "Olá! Vim pelo chat da VouComprarFácil e gostaria de fazer um pedido.",
  hours: "Seg a Sex: 9h às 18h",
  address: ""
};

function generateWhatsAppLink(message) {
  const encodedMessage = encodeURIComponent(message || whatsappConfig.defaultMessage);
  return `https://wa.me/${whatsappConfig.phoneNumber}?text=${encodedMessage}`;
}

function formatProductMessage(product) {
  return `${product.image} *${product.name}*\n${product.description}\n\n*Valor: R$ ${product.price.toFixed(2).replace('.', ',')}*${product.promo ? '\n\n🔥 PROMOÇÃO DO DIA!' : ''}`;
}

module.exports = {
  whatsappConfig,
  generateWhatsAppLink,
  formatProductMessage
};