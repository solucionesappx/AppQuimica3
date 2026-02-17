// Acceso rápido al documento de datos
const getDataSheet = (name) => SpreadsheetApp.openById(DATA_SS_ID).getSheetByName(name);

/**
 * Receptora de peticiones lógicas (Llamada desde doGet cuando action === "procesarReaccion")
 */
function procesarPeticionQuimica(params) {
  const subAction = params.subAction;
  
  switch(subAction) {
    case "getValencias":
      return { success: true, data: obtenerValencias(params.simbolo) };
      
    case "calcularProducto":
      return calcularProductoFinal(params.simbolo, params.valencia);
      
    default:
      return { success: false, message: "Sub-acción no reconocida" };
  }
}

/**
 * Obtiene todas las valencias de un elemento desde TD102_VALENCIAS
 */
function obtenerValencias(simbolo) {
  const sheet = getDataSheet(HOJAS.VALENCIAS);
  if (!sheet) return [];
  
  const data = sheet.getDataRange().getValues();
  // El símbolo está en la columna B (índice 1)
  const fila = data.find(row => row[1] === simbolo);
  
  if (!fila) return [];
  
  // Extraer EO1 hasta EO8 (Columnas D a K -> índices 3 a 10)
  // Filtramos valores vacíos o no numéricos
  return fila.slice(3, 11).filter(v => v !== "" && v !== null && !isNaN(v));
}

/**
 * Lógica Maestra: Calcula Fórmula y Nombre
 */
function calcularProductoFinal(simbolo, valenciaElegida) {
  try {
    const vElegida = parseFloat(valenciaElegida);
    const valenciasTodas = obtenerValencias(simbolo);
    const cantValencias = valenciasTodas.length;
    
    // Encontrar la posición de la valencia elegida (1º, 2º, etc.) para la nomenclatura
    // Ordenamos de menor a mayor para que la posición coincida con la tabla TD201
    const valenciasOrdenadas = [...valenciasTodas].sort((a, b) => a - b);
    const posicion = valenciasOrdenadas.indexOf(vElegida) + 1;

    // 1. Obtener Raíz o Excepción (TD202)
    const dataExc = getDataSheet(HOJAS.EXCEPCIONES).getDataRange().getValues();
    const excepcion = dataExc.find(row => row[1] === simbolo);
    // Asumimos que la columna TD202SUFIJO es la 4ª (índice 3)
    let raiz = excepcion ? excepcion[3] : simbolo; 

    // 2. Obtener Nomenclatura (TD201)
    const dataNom = getDataSheet(HOJAS.NOMENCLATURA).getDataRange().getValues();
    const regla = dataNom.find(row => row[0] == cantValencias && row[1] == posicion);
    
    let nombreFinal = "";
    if (regla) {
      const prefijo = regla[2] || "";
      const sufijo = regla[3] || "";
      nombreFinal = `${prefijo}${raiz}${sufijo}`.toLowerCase();
    } else {
      nombreFinal = `${raiz}ico`;
    }

    // 3. Formular Producto (Intercambio de valencias con Oxígeno -2)
    // Ley de aspa: Elemento_2 O_valencia
    let subElemento = 2;
    let subOxigeno = vElegida;

    // Simplificar si ambos son pares
    if (subOxigeno % 2 === 0) {
      subElemento = 1;
      subOxigeno = subOxigeno / 2;
    }

    const formula = `${simbolo}${subElemento > 1 ? subElemento : "" }O${subOxigeno > 1 ? subOxigeno : ""}`;

    return {
      success: true,
      formula: formula,
      nombre: nombreFinal,
      valenciaUsada: vElegida,
      esExcepcion: !!excepcion
    };

  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

/**
 * Obtiene nombres amigables para el selector de tablas
 */
function getTableFriendlyNames(appTienda) {
  try {
    const ssConfig = SpreadsheetApp.openById(CONFIG_SS_ID);
    const sheet = ssConfig.getSheetByName("ConfigTB");
    if (!sheet) return { success: false, message: "Hoja ConfigTB no encontrada" };

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const rows = data.slice(1);

    // Mapeamos los datos para que el frontend reciba un diccionario útil
    // Filtramos por AppTienda (si se proporciona)
    const configMap = {};
    
    rows.forEach(row => {
      const tienda = row[0]; // AppTienda
      const nombreTecnico = row[1]; // Nombre_Tabla (ej: TD101_BASIC)
      const nombreAmigable = row[2]; // Descripción_Tabla (ej: PRINCIPAL)
      
      if (!appTienda || tienda === appTienda) {
        configMap[nombreTecnico] = {
          label: nombreAmigable,
          c1: row[3], // ConfgTB01 (opcional para usos futuros)
          c2: row[4]  // ConfgTB02
        };
      }
    });

    return { success: true, data: configMap };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

/**
 * Procesa todas las hojas del documento DATA_SS_ID y extrae los encabezados
 * para consolidarlos en una tabla dentro de 'hojaX'.
 */
function generateHeadersInventory() {
  const TARGET_SHEET_NAME = 'hojaX';
  
  try {
    const ss = SpreadsheetApp.openById(DATA_SS_ID);
    const sheets = ss.getSheets();
    let inventoryData = [];

    // Iterar por cada hoja del documento
    sheets.forEach(sheet => {
      const sheetName = sheet.getName();
      
      // Evitar procesar la hoja de destino para no crear bucles de datos
      if (sheetName === TARGET_SHEET_NAME) return;

      // Obtener la primera fila (encabezados)
      // getRange(fila, columna, numFilas, numColumnas)
      const lastColumn = sheet.getLastColumn();
      
      if (lastColumn > 0) {
        const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
        
        headers.forEach(header => {
          if (header !== "") {
            inventoryData.push([sheetName, header]);
          }
        });
      }
    });

    // Gestión de la hoja de destino 'hojaX'
    let targetSheet = ss.getSheetByName(TARGET_SHEET_NAME);
    if (!targetSheet) {
      targetSheet = ss.insertSheet(TARGET_SHEET_NAME);
    } else {
      targetSheet.clearContents(); // Limpiar contenido previo
    }

    // Insertar encabezados de la nueva tabla
    targetSheet.getRange(1, 1, 1, 2).setValues([["Hoja", "Columna"]]);
    targetSheet.getRange(1, 1, 1, 2).setFontWeight("bold");

    // Insertar los datos recolectados
    if (inventoryData.length > 0) {
      targetSheet.getRange(2, 1, inventoryData.length, 2).setValues(inventoryData);
    }

    Logger.log("Inventario generado con éxito en " + TARGET_SHEET_NAME);
    
  } catch (e) {
    Logger.log("Error: " + e.toString());
  }
}
