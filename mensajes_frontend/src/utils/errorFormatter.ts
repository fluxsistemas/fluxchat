export const getFriendlyError = (rawError: string | null | undefined): string => {
  if (!rawError) return '';

  const extractMsg = (obj: any): string => {
    if (!obj) return '';
    
    // Si es un objeto de chequeo de whatsapp directo
    if (obj.exists === false) {
      return 'El número no está registrado en WhatsApp';
    }
    
    // Buscar mensaje anidado de respuesta primero (ej. {"response":{"message":"Connection Closed"}})
    if (obj.response && typeof obj.response === 'object') {
      if (obj.response.message) {
        if (Array.isArray(obj.response.message)) {
          const firstItem = obj.response.message[0];
          if (firstItem && firstItem.exists === false) {
            return 'Número no existe';
          }
        }
        return typeof obj.response.message === 'string' 
          ? obj.response.message 
          : JSON.stringify(obj.response.message);
      }
      if (obj.response.error) {
        return typeof obj.response.error === 'string' 
          ? obj.response.error 
          : JSON.stringify(obj.response.error);
      }
    }
    
    if (obj.message) {
      if (Array.isArray(obj.message)) {
        const firstItem = obj.message[0];
        if (firstItem && firstItem.exists === false) {
          return 'Número no existe';
        }
      }
      return typeof obj.message === 'string' 
        ? obj.message 
        : JSON.stringify(obj.message);
    }
    
    if (obj.error) {
      if (typeof obj.error === 'object') {
        if (obj.error.message) {
          return typeof obj.error.message === 'string' 
            ? obj.error.message 
            : JSON.stringify(obj.error.message);
        }
        if (obj.error.exists === false) {
          return 'El número no está registrado en WhatsApp';
        }
        return JSON.stringify(obj.error);
      }
      return String(obj.error);
    }
    
    if (obj.detail) {
      return typeof obj.detail === 'string' ? obj.detail : JSON.stringify(obj.detail);
    }
    
    return '';
  };

  let finalMsg = '';

  // 1. Intentar parsear el JSON de forma directa
  try {
    const parsed = JSON.parse(rawError);
    finalMsg = extractMsg(parsed);
  } catch (e) {}

  // 2. Extraer JSON si viene precedido de un prefijo (ej: "500 - { ... }")
  if (!finalMsg) {
    const jsonMatch = rawError.match(/\{.*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        finalMsg = extractMsg(parsed);
      } catch (e) {}
    }
  }

  // 3. Fallback al string crudo si no se pudo extraer o parsear un mensaje
  const displayMsg = finalMsg || rawError;
  return typeof displayMsg === 'string' ? displayMsg : JSON.stringify(displayMsg);
};
