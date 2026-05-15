const whatsappConfig = {
  phoneNumber: "5511999999999",
  businessName: "NOSSA LOJA",
  defaultMessage: "Olá! vim pelo chat do site e gostaria de fazer um pedido.",
  hours: "Seg a Sex: 9h às 20h | Sáb: 9h às 18h",
  address: "Rua exemplo, 123 - Centro"
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