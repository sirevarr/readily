/* Readily v2 — constantes */

export const LS = {
  gemini:   'readily_gemini_key',
  sbUrl:    'readily_sb_url',
  sbKey:    'readily_sb_key',
  settings: 'readily_settings',
  models:   'readily_models',
  cooldown: 'readily_model_cd',
  zoom:     'readily_zoom',
  sideW:    'readily_side_w',
  sideOpen: 'readily_side_open',
  user:     'readily_user',
};

export const GEMINI_BASE  = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_MODEL = 'gemini-3.5-flash';

export const COLORS = [
  { name: 'ámbar',  hex: '#F2C94C' },
  { name: 'salvia', hex: '#7FC592' },
  { name: 'rosa',   hex: '#EE8FB3' },
  { name: 'cielo',  hex: '#7DBDE8' },
];

export const CATEGORIES = ['Sin categoría','Ciencia','Tecnología','Historia','Literatura','Filosofía','Arte','Economía','Medicina','Matemáticas','Derecho','Otro'];

export const CATEGORY_EMOJI = {
  'Ciencia':'🔬','Tecnología':'💻','Historia':'📜','Literatura':'📖','Filosofía':'🧠','Arte':'🎨',
  'Economía':'📈','Medicina':'⚕️','Matemáticas':'∑','Derecho':'⚖️','Otro':'📄','Sin categoría':'📚',
};

export const QUIZ_EVERY_N = 5;       // páginas leídas entre pausas de comprensión
export const MAX_CHAT_HISTORY = 20;  // mensajes que se envían como historial al chat
export const CTX_CHAR_BUDGET = 14000; // caracteres de documento que se envían a la IA por pregunta

/* 1 unidad de escala pdf.js = 1pt = 1/72in. Acrobat muestra 100% = 96dpi => 1.3333 */
export const PDF_UNIT = 96 / 72;
export const MIN_SCALE = 0.3;
export const MAX_SCALE = 6;

/* Bloque de estilo de explicación — se inyecta en los prompts de IA (conservado de v1) */
export const STYLE_BLOCK = `Al explicar, sigue estas reglas de estilo:

1. Ve directo a la base lógica: qué es lo mínimo que hace que esto tenga sentido, antes que la descripción general.
2. Evita metáforas espaciales o decorativas ("como un puente entre...", "imagina un mundo donde..."). Si necesitas comparar algo, usa una acción o consecuencia concreta, no una imagen visual/espacial.
3. Si hay una relación de causa-efecto, exprésala explícita: "si pasa X, entonces Y". No la dejes implícita.
4. No agregues definiciones o datos adicionales "por si acaso" que no sean necesarios para responder lo pedido. Menos es mejor que exhaustivo.
5. Si el tema tiene una lógica fija/determinista (matemática, física, regla química fija), puedes cerrar con una versión comprimida tipo fórmula o regla corta.
6. Si el tema requiere interpretación, análisis, o tiene varias causas válidas a la vez (no una sola regla), dilo explícitamente: aclara que aquí no hay un único camino, y presenta las alternativas en tensión en vez de simplificar de más.
7. Nunca uses negrita ("**").`;
