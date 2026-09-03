// Datos de posiciones por comitente.
// t=ticker, n=nombre, c=cantidad, p=precio, co=costo promedio, pa=precio anterior
// IMPORTANTE: transcripto a mano desde capturas de pantalla del broker (03/09/2026).
// Verificar contra el reporte real antes de usar para decisiones. Los totales de
// portafolio/cuenta corriente son los que muestra el resumen del broker (confiables);
// las filas de detalle pueden tener algún error de dígito en "costo".

const BONOS = ["T31Y7","TZXS8","T15E7","S3O6","GD30","GN47O","MGCMO","MGCNO","MGCOO","YM34O","BPOB7","BPOD7","PLC4O"];

const CLIENTES = [
  {
    id: "1237", nombre: "ZUNINO DIAZ GUIDO", tc: 1534.30,
    totalPortfolio: 2094316191.83,
    pesos: { valor: 2828574530.00, cuentaCorriente: -106576909.64 },
    dolares: { valorUSD: 0, valorARS: 0, cuentaCorrienteUSD: -409098.70, cuentaCorrienteARS: -627681428.53 },
    detallePesos: [
      { t:"CVH", n:"CABLEVISION HOLDING S.A.", c:160000, p:9420.000, co:4564.385, pa:9450.000 },
      { t:"GCLA", n:"GRUPO CLARIN", c:90000, p:3750.000, co:3129.946, pa:3810.000 },
      { t:"GGAL", n:"GGAL - GRUPO FIN.GALICIA", c:25000, p:7055.000, co:7633.428, pa:7170.000 },
      { t:"GOOGL", n:"GOOGL - CEDEAR ALPHABET INC", c:15000, p:9365.000, co:9526.331, pa:9285.000 },
      { t:"NU", n:"CEDEAR NU HOLDINGS LTD/CAYMAN ISLANDS", c:25993, p:12210.000, co:10850.180, pa:12200.000 },
      { t:"T31Y7", n:"BONO TESORO NACIONAL CAPITALIZ", c:90000000, p:125.500, co:124.537, pa:125.250 },
      { t:"TZXS8", n:"BONO TESORO NACIONAL CERO CUPO", c:250000000, p:94.680, co:86.238, pa:94.480 }
    ],
    detalleDolares: [],
    caucion: { fechaInicioPesos: null, fechaInicioUSD: null },
    ganancias: []
  },
  {
    id: "1238", nombre: "ZUNINO GABRIEL JU...", tc: 1534.30,
    totalPortfolio: 2255917445.08,
    pesos: { valor: 1528556360.00, cuentaCorriente: -91022442.90 },
    dolares: { valorUSD: 948931.90, valorARS: 1455949213.65, cuentaCorrienteUSD: -415540.88, cuentaCorrienteARS: -637565685.67 },
    detallePesos: [
      { t:"CVH", n:"CABLEVISION HOLDING S.A.", c:4698, p:9420.000, co:6714.339, pa:9450.000 },
      { t:"GCLA", n:"GRUPO CLARIN", c:13776, p:3750.000, co:3129.947, pa:3810.000 },
      { t:"GGAL", n:"GGAL - GRUPO FIN.GALICIA", c:30000, p:7055.000, co:7428.418, pa:7170.000 },
      { t:"GOOGL", n:"GOOGL - CEDEAR ALPHABET INC", c:23000, p:9365.000, co:9752.675, pa:9285.000 },
      { t:"INTC", n:"INTC CEDEAR INTEL CO.", c:10000, p:28700.000, co:32939.130, pa:28640.000 },
      { t:"NU", n:"CEDEAR NU HOLDINGS LTD/CAYMAN ISLANDS", c:15000, p:12210.000, co:9272.068, pa:12200.000 }
    ],
    detalleDolares: [],
    caucion: { fechaInicioPesos: null, fechaInicioUSD: null },
    ganancias: [],
    alertas: ["TSLA aparecía con cantidad vacía y resultado inconsistente en la captura — no se cargó, revisar operación de venta."]
  },
  {
    id: "1239", nombre: "ZUNINO DIAZ FRANC...", tc: 1534.30,
    totalPortfolio: 1950247101.96,
    pesos: { valor: 2671852280.00, cuentaCorriente: -104116969.28 },
    dolares: { valorUSD: 30714.27, valorARS: 47125001.55, cuentaCorrienteUSD: -433169.42, cuentaCorrienteARS: -664613210.31 },
    detallePesos: [
      { t:"CVH", n:"CABLEVISION HOLDING S.A.", c:157884, p:9420.000, co:5216.917, pa:9450.000 },
      { t:"GCLA", n:"GRUPO CLARIN", c:90000, p:3750.000, co:3129.946, pa:3810.000 },
      { t:"GGAL", n:"GGAL - GRUPO FIN.GALICIA", c:25000, p:7055.000, co:7325.685, pa:7170.000 },
      { t:"GOOGL", n:"GOOGL - CEDEAR ALPHABET INC", c:10000, p:9365.000, co:9222.264, pa:9285.000 },
      { t:"INTC", n:"INTC CEDEAR INTEL CO.", c:13000, p:28700.000, co:33999.002, pa:28640.000 },
      { t:"MU", n:"CEDEAR MICRON TECHNOLOGY INC", c:200, p:300300.000, co:300641.421, pa:304725.000 },
      { t:"SNDK", n:"CEDEAR SANDISK CORPORATION", c:10000, p:14390.000, co:14414.800, pa:14560.000 }
    ],
    detalleDolares: [
      { t:"TSM", n:"CEDEAR TAIWAN SEMICONDUCTOR MANUF.", c:600, p:47.513, co:47.890, pa:48.040 },
      { t:"PLC4O", n:"PLUSPETROL S A/NT 20320529 UNSEC R", c:2000, p:110.311, co:110.569, pa:110.850 }
    ],
    caucion: { fechaInicioPesos: null, fechaInicioUSD: null },
    ganancias: [],
    alertas: ["TSLA aparecía con cantidad vacía y resultado inconsistente en la captura — no se cargó, revisar operación de venta."]
  },
  {
    id: "1323", nombre: "QUINTANA LAMBOIS...", tc: 1534.30,
    totalPortfolio: 7636649.64,
    pesos: { valor: 7489248.00, cuentaCorriente: 17722.34 },
    dolares: { valorUSD: 0, valorARS: 0, cuentaCorrienteUSD: 84.52, cuentaCorrienteARS: 129679.30 },
    detallePesos: [
      { t:"TSLA", n:"TSLA CEDEAR TESLA, INC", c:69, p:40480.000, co:40638.107, pa:37880.000 },
      { t:"TZXS8", n:"BONO TESORO NACIONAL CERO CUPO", c:4960000, p:94.680, co:88.798, pa:94.480 }
    ],
    detalleDolares: [],
    caucion: { fechaInicioPesos: null, fechaInicioUSD: null },
    ganancias: []
  },
  {
    id: "1329", nombre: "ZUNINO DIAZ CARLA", tc: 1534.30,
    totalPortfolio: 54562190.43,
    pesos: { valor: 54415721.67, cuentaCorriente: 12815.61 },
    dolares: { valorUSD: 0, valorARS: 0, cuentaCorrienteUSD: 87.11, cuentaCorrienteARS: 133653.15 },
    detallePesos: [
      { t:"GOOGL", n:"GOOGL - CEDEAR ALPHABET INC", c:214, p:9370.000, co:9372.627, pa:9285.000 },
      { t:"INTC", n:"INTC CEDEAR INTEL CO.", c:300, p:28700.000, co:33079.860, pa:28640.000 },
      { t:"TSLA", n:"TSLA CEDEAR TESLA, INC", c:450, p:40460.000, co:40818.542, pa:37880.000 },
      { t:"T15E7", n:"REP.ARGENTINA//0Bono20270115", c:1434041, p:147.339, co:135.649, pa:147.199 },
      { t:"TZXS8", n:"BONO TESORO NACIONAL CERO CUPO", c:24800000, p:94.680, co:88.648, pa:94.480 }
    ],
    detalleDolares: [],
    caucion: { fechaInicioPesos: null, fechaInicioUSD: null },
    ganancias: []
  },
  {
    id: "1363", nombre: "BUCURE DELFINA", tc: 1534.30,
    totalPortfolio: 112406687.38,
    pesos: { valor: 34588970.00, cuentaCorriente: 16257.35 },
    dolares: { valorUSD: 46762.00, valorARS: 71747084.41, cuentaCorrienteUSD: 3946.01, cuentaCorrienteARS: 6054375.62 },
    detallePesos: [
      { t:"EWZ", n:"CEDEAR I SHARES MSCI BRAZIL CAP", c:268, p:30160.000, co:20684.702, pa:30340.000 },
      { t:"NU", n:"CEDEAR NU HOLDINGS LTD/CAYMAN ISLANDS", c:238, p:12210.000, co:11005.411, pa:12200.000 },
      { t:"MGCNO", n:"ON PAMPA ENER CLASE 22 VTO 04-", c:14900, p:158390.000, co:140829.734, pa:158800.000 }
    ],
    detalleDolares: [
      { t:"MGCOO", n:"ON Pampa Energia 16/12/34", c:10000, p:108.773, co:110.550, pa:109.550 },
      { t:"PLC4O", n:"PLUSPETROL S A/NT 20320529 UNSEC R", c:13000, p:110.311, co:110.148, pa:110.850 },
      { t:"BPOB7", n:"BPOB7 - BOPREAL S. 1B VTO31/10/27 U$S CG", c:325, p:103.480, co:105.879, pa:103.650 },
      { t:"BPOD7", n:"BPOD7 - BOPREAL S. 1D VTO31/10/27 U$S CG", c:20460, p:103.656, co:103.517, pa:103.550 }
    ],
    caucion: { fechaInicioPesos: null, fechaInicioUSD: null },
    ganancias: []
  },
  {
    id: "1374", nombre: "CECILIA MARIA DIAZ", tc: 1534.30,
    totalPortfolio: 56290016.91,
    pesos: { valor: 54929042.70, cuentaCorriente: 1344587.85 },
    dolares: { valorUSD: 0, valorARS: 0, cuentaCorrienteUSD: 10.68, cuentaCorrienteARS: 16386.36 },
    detallePesos: [
      { t:"AAPL", n:"AAPL - CEDEAR APPLE INC.", c:1, p:26240.000, co:24804.892, pa:25860.000 },
      { t:"GOOGL", n:"GOOGL - CEDEAR ALPHABET INC", c:1000, p:9370.000, co:9706.433, pa:9285.000 },
      { t:"INTC", n:"INTC CEDEAR INTEL CO.", c:200, p:28700.000, co:28769.454, pa:28640.000 },
      { t:"NU", n:"CEDEAR NU HOLDINGS LTD/CAYMAN ISLANDS", c:2000, p:12210.000, co:11247.152, pa:12200.000 },
      { t:"TSLA", n:"TSLA CEDEAR TESLA, INC", c:300, p:40460.000, co:37196.465, pa:37880.000 },
      { t:"T15E7", n:"REP.ARGENTINA//0Bono20270115", c:2195483, p:147.339, co:141.568, pa:147.199 }
    ],
    detalleDolares: [],
    caucion: { fechaInicioPesos: null, fechaInicioUSD: null },
    ganancias: [],
    alertas: ["La tabla Detalle Dólares no se alcanzó a ver completa en la captura (parecía vacía, coherente con Portafolio en dólares = 0)."]
  },
  {
    id: "1416", nombre: "BARENAS, AGUSTIN", tc: 1534.30,
    totalPortfolio: 69561828.53,
    pesos: { valor: 68355435.19, cuentaCorriente: 1232138.95 },
    dolares: { valorUSD: 0, valorARS: 0, cuentaCorrienteUSD: -16.78, cuentaCorrienteARS: -25745.61 },
    detallePesos: [
      { t:"GOOGL", n:"GOOGL - CEDEAR ALPHABET INC", c:1000, p:9370.000, co:9393.977, pa:9285.000 },
      { t:"WMT", n:"WMT CEDEAR WAL-MART STORES", c:1000, p:9640.000, co:9218.342, pa:9410.000 },
      { t:"T15E7", n:"REP.ARGENTINA//0Bono20270115", c:7722312, p:147.339, co:133.163, pa:147.199 },
      { t:"TZXS8", n:"BONO TESORO NACIONAL CERO CUPO", c:30000000, p:94.680, co:92.550, pa:94.480 },
      { t:"S3O6", n:"LETRA TESORO NACIONAL CAPITALI", c:421101, p:130.600, co:111.426, pa:130.450 },
      { t:"MU", n:"CEDEAR MICRON TECHNOLOGY INC", c:30, p:300450.000, co:299081.740, pa:304725.000 }
    ],
    detalleDolares: [],
    caucion: { fechaInicioPesos: null, fechaInicioUSD: null },
    ganancias: [],
    alertas: ["TSLA aparecía con cantidad vacía y resultado inconsistente en la captura — no se cargó, revisar operación de venta."]
  },
  {
    id: "1483", nombre: "TORTORELLI, MARIA...", tc: 1534.30,
    totalPortfolio: 23111943.82,
    pesos: { valor: 14694426.28, cuentaCorriente: 552786.94 },
    dolares: { valorUSD: 5125.53, valorARS: 7864116.88, cuentaCorrienteUSD: 0.40, cuentaCorrienteARS: 613.72 },
    detallePesos: [
      { t:"GOOGL", n:"GOOGL - CEDEAR ALPHABET INC", c:100, p:9370.000, co:9433.347, pa:9285.000 },
      { t:"INTC", n:"INTC CEDEAR INTEL CO.", c:100, p:28700.000, co:29064.633, pa:28640.000 },
      { t:"NU", n:"CEDEAR NU HOLDINGS LTD/CAYMAN ISLANDS", c:133, p:12210.000, co:11423.312, pa:12200.000 },
      { t:"T15E7", n:"REP.ARGENTINA//0Bono20270115", c:2663800, p:147.339, co:145.990, pa:147.199 },
      { t:"TZXS8", n:"BONO TESORO NACIONAL CERO CUPO", c:3100000, p:94.680, co:95.182, pa:94.480 },
      { t:"MU", n:"CEDEAR MICRON TECHNOLOGY INC", c:8, p:300450.000, co:251885.051, pa:304725.000 }
    ],
    detalleDolares: [
      { t:"PLC4O", n:"PLUSPETROL S A/NT 20320529 UNSEC R", c:2000, p:110.311, co:111.200, pa:110.850 },
      { t:"YM34O", n:"ON YPF 17/01/34", c:2685, p:108.727, co:110.712, pa:109.100 }
    ],
    caucion: { fechaInicioPesos: null, fechaInicioUSD: null },
    ganancias: []
  },
  {
    id: "1502", nombre: "PEREZ GOMEZ, SANT...", tc: 1534.30,
    totalPortfolio: 0,
    pesos: { valor: 0, cuentaCorriente: 0 },
    dolares: { valorUSD: 0, valorARS: 0, cuentaCorrienteUSD: 0, cuentaCorrienteARS: 0 },
    detallePesos: [],
    detalleDolares: [],
    caucion: { fechaInicioPesos: null, fechaInicioUSD: null },
    ganancias: []
  }
];

const TASA_TNA_USD = 0.02;   // caución tomada en dólares
const TASA_TNA_ARS = 0.24;   // caución / excedente en pesos
