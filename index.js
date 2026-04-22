const express = require('express');
const axios = require('axios');
const xml2js = require('xml2js');
const fs = require('fs');
const path = require('path');

const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '5mb' }));

const BOE_BASE = 'https://boe.es/datosabiertos/api/legislacion-consolidada';

// ---------------------------------------------------------------------------
// CORPUS VOX: se carga una vez al arrancar el proxy
// ---------------------------------------------------------------------------
let CORPUS = [];
try {
  const corpusPath = path.join(__dirname, 'corpus.json');
  CORPUS = JSON.parse(fs.readFileSync(corpusPath, 'utf-8'));
  console.log(`Corpus VOX cargado: ${CORPUS.length} propuestas.`);
} catch (e) {
  console.error('No se pudo cargar corpus.json:', e.message);
}

// Diccionario de temas (mismo que el motor.py de referencia)
const TEMAS = {
  vivienda:       ['vivienda','alquiler','okupa','inquiocupa','hipoteca','vut',' ibi ',' itp ','suelo','urbaniz','desahucio','arrendador','arrendatario'],
  fiscalidad:     ['impuesto','irpf',' iva ','sociedades','tributación','tributar','cotización','patrimonio','sucesiones','fiscal','hacienda','recaudación'],
  inmigracion:    ['inmigra','inmigrante','extranjero','frontera','nacionalidad','arraigo','repatria','deporta','schengen','mena ','refugiado','remigra','muro'],
  autonomias:     ['autonómic','autonomía','cataluña','catalán','vasco','navarro','comunidad autónoma','concierto económico','cooficial','estatuto'],
  seguridad:      ['policía','guardia civil','terrori',' eta ','yihad','defensa','fcse','código penal','cuerpos y fuerzas'],
  educacion:      ['educación','educativ','escuela','colegio','universidad','pin parental','cheque escolar','bachiller','oposición','profesor','docente'],
  familia:        ['familia','natalidad','maternidad','paternidad','custodia','aborto','vientre de alquiler','divorcio','hijo','menor','violencia de género','violencia intrafamiliar'],
  sanidad:        ['sanidad','sanitari',' salud ','hospital','médic','farmacia','vacuna','seguridad social'],
  energia:        ['energí','nuclear','renovabl','fósil','eléctric','factura de la luz','co2','climátic','pacto verde','emision'],
  justicia:       ['judicial','juez','tribunal supremo','tribunal constitucional','fiscalía','cgpj','cadena perpetua','jurado','sentencia','pena de'],
  trabajo:        ['empleo','salario','trabajador','autónom',' smi ','pensión','pensiones','jubilaci',' paro ','desempleo','reforma laboral','cotizaciones'],
  administracion: ['burocra','funcionari','subvención','subvencion','ayuntamiento','gasto público','administración pública','administraciones públicas','presupuestos generales','silencio administrativo','declaración responsable','simplificación','derogar','normativ','tramit','inteligencia artificial','despilfarro'],
  simbolos:       ['bandera','himno','corona','símbolo','memoria histórica','memoria democrática','hispanidad'],
  europa:         ['unión europea','bruselas','comisión europea',' ue ',' pac ','visegrado','tratado europeo','parlamento europeo'],
  campo:          ['agrícol','agrari','ganader','mundo rural','españa rural','caza','tauromaquia','pesca','regadío','agua','plan hidrológico'],
  libertades:     ['libertad de expresión','medio de comunicación','censura','ley mordaza']
};

function detectarTemas(texto) {
  const t = texto.toLowerCase();
  const temas = [];
  for (const [tema, kws] of Object.entries(TEMAS)) {
    if (kws.some(kw => t.includes(kw))) temas.push(tema);
  }
  return temas;
}

// Puntúa cada propuesta: +2 por cada tema compartido, +3/+2/+1 según año
function seleccionarPropuestas(texto, maxResultados = 80) {
  const temasLey = detectarTemas(texto);
  if (temasLey.length === 0) {
    // Si no detectamos temas, mandamos una muestra representativa (más recientes primero)
    return CORPUS.slice().sort((a, b) => b.año - a.año).slice(0, maxResultados);
  }
  const scored = [];
  for (const r of CORPUS) {
    const compartidos = (r.temas || []).filter(t => temasLey.includes(t)).length;
    if (compartidos === 0) continue;
    const prio = r.año >= 2025 ? 3 : (r.año >= 2023 ? 2 : 1);
    const score = compartidos * 2 + prio;
    scored.push({ ...r, score, prio });
  }
  scored.sort((a, b) => (b.score - a.score) || (b.prio - a.prio));
  return scored.slice(0, maxResultados);
}

// ---------------------------------------------------------------------------
// Endpoints BOE (idénticos al original)
// ---------------------------------------------------------------------------
app.get('/buscar', async (req, res) => {
  try {
    const { consulta } = req.query;
    if (!consulta) return res.status(400).json({ error: 'Falta el parámetro consulta' });

    const query = JSON.stringify({
      query: { query_string: { query: `titulo:${consulta}` } },
      sort: [{ fecha_publicacion: 'desc' }]
    });

    const response = await axios.get(BOE_BASE, {
      params: { query, limit: 10 },
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
    });

    const items = response.data?.data || [];
    const resultados = (Array.isArray(items) ? items : []).map(item => ({
      identificador: item.identificador,
      titulo: item.titulo,
      fecha_publicacion: item.fecha_publicacion,
      rango: item.rango?.texto || item.rango,
      departamento: item.departamento?.texto || item.departamento,
      vigencia_agotada: item.vigencia_agotada,
      url: item.url_html_consolidada
    }));

    res.json({ ok: true, resultados });
  } catch (error) {
    res.status(500).json({ error: error.message, status: error.response?.status });
  }
});

app.get('/norma/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const metaResponse = await axios.get(`${BOE_BASE}/id/${id}/metadatos`, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
    });

    const textoResponse = await axios.get(`${BOE_BASE}/id/${id}/texto`, {
      headers: { 'Accept': 'application/xml', 'User-Agent': 'Mozilla/5.0' },
      responseType: 'text'
    });

    const parser = new xml2js.Parser({ explicitArray: false });
    const textoXml = await parser.parseStringPromise(textoResponse.data);

    const bloques = textoXml?.response?.data?.texto?.bloque;
    const bloquesArray = Array.isArray(bloques) ? bloques : (bloques ? [bloques] : []);

    let textoPlano = '';
    for (const bloque of bloquesArray.slice(0, 30)) {
      const titulo = bloque?.$?.titulo || '';
      const versiones = bloque?.version;
      const versionArray = Array.isArray(versiones) ? versiones : (versiones ? [versiones] : []);
      const ultimaVersion = versionArray[versionArray.length - 1];
      const parrafos = ultimaVersion?.p;
      const parrafoArray = Array.isArray(parrafos) ? parrafos : (parrafos ? [parrafos] : []);
      const textoBloque = parrafoArray.map(p => (typeof p === 'string' ? p : p?._ || '')).join(' ');
      if (titulo || textoBloque) {
        textoPlano += `\n${titulo}\n${textoBloque}\n`;
      }
    }

    res.json({
      ok: true,
      metadatos: metaResponse.data?.data || metaResponse.data,
      texto: textoPlano.substring(0, 12000)
    });
  } catch (error) {
    res.status(500).json({ error: error.message, status: error.response?.status });
  }
});

// ---------------------------------------------------------------------------
// ANÁLISIS: ahora con corpus VOX real
// ---------------------------------------------------------------------------
app.post('/analizar', async (req, res) => {
  try {
    const { textoLey, pregunta } = req.body;
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) return res.status(401).json({ error: 'Falta API key' });
    if (!textoLey || !pregunta) return res.status(400).json({ error: 'Faltan parámetros' });

    // Seleccionar propuestas del corpus relevantes para esta ley
    const propuestas = seleccionarPropuestas(textoLey, 80);

    // Payload compacto para el prompt
    const corpusCompacto = propuestas.map(p => ({
      id: p.id,
      año: p.año,
      temas: p.temas,
      texto: p.texto
    }));

    const systemPrompt = `Eres un analista legislativo que compara textos del BOE con el programa oficial de VOX.

A continuación recibes:
1. El texto de una ley del BOE.
2. Una selección de propuestas oficiales de VOX extraídas de sus tres documentos programáticos: "100 medidas para la España Viva" (2018), el "Programa electoral 2023" y el "Programa económico y de vivienda 2025".

Tu tarea: identificar qué artículos concretos de la ley entran en conflicto con qué propuestas concretas del programa.

REGLA DE PRIORIDAD TEMPORAL: cuando varias propuestas tratan el mismo asunto, prevalece la más reciente (2025 > 2023 > 2018). Cita la de mayor año; si la antigua añade un matiz no contradicho, puedes mencionarla como complemento.

ESTRUCTURA de tu respuesta (en Markdown, legible):

## Resumen
2-3 frases sobre la compatibilidad global de la ley con el programa de VOX.

## Conflictos detectados
Para cada conflicto, usa este formato:

### [Nombre del artículo de la ley]
- **Cita de la ley:** "..."
- **Propuesta de VOX que choca:** [ID, ej. 2025-VI-03] — "cita textual breve"
- **Tipo de conflicto:** contradicción directa / incompatibilidad parcial / tensión interpretativa
- **Explicación:** 2-3 frases.
- **Alternativa legislativa:** qué artículo modificar y en qué dirección (según la propuesta de VOX).

## Puntos de alineación (opcional)
Si hay artículos que SÍ coinciden con el programa, menciónalos brevemente.

IMPORTANTE: solo cita ids y textos que aparezcan en el corpus que te paso. No inventes.`;

    const userContent = `TEXTO DE LA LEY (BOE):

${textoLey}

---

CORPUS DE PROPUESTAS DE VOX (ordenado por relevancia temática, formato JSON):

${JSON.stringify(corpusCompacto)}

---

PREGUNTA/ENFOQUE DEL USUARIO:

${pregunta}

Analiza artículo por artículo aplicando la regla de prioridad temporal.`;

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }]
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      }
    );

    res.json({
      analisis: response.data.content[0].text,
      meta: {
        propuestas_usadas: propuestas.length,
        temas_detectados: detectarTemas(textoLey)
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message, detalle: error.response?.data });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Proxy VOX-Legislativo corriendo en puerto ${PORT}`);
});
