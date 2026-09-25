// Built-in functions offered by autocompletion: exactly the ones the engine
// implements (tools/tfplay/engine/funcs.go, checked by completion.test.ts),
// with Terraform's signatures.

export interface FunctionInfo {
  sig: string;
  doc: string;
}

export const FUNCTIONS: Record<string, FunctionInfo> = {
  // numeric
  abs: { sig: 'abs(num number) number', doc: 'Valor absoluto.' },
  ceil: { sig: 'ceil(num number) number', doc: 'Redondea hacia arriba al entero más cercano.' },
  floor: { sig: 'floor(num number) number', doc: 'Redondea hacia abajo al entero más cercano.' },
  log: { sig: 'log(num number, base number) number', doc: 'Logaritmo de num en la base indicada.' },
  max: { sig: 'max(numbers...) number', doc: 'El mayor de los números.' },
  min: { sig: 'min(numbers...) number', doc: 'El menor de los números.' },
  parseint: { sig: 'parseint(str string, base number) number', doc: 'Convierte un texto en entero, en la base indicada.' },
  pow: { sig: 'pow(num number, power number) number', doc: 'Potencia: num elevado a power.' },
  signum: { sig: 'signum(num number) number', doc: 'Signo del número: -1, 0 o 1.' },
  sum: { sig: 'sum(list list(number)) number', doc: 'Suma los números de una lista.' },

  // strings
  chomp: { sig: 'chomp(str string) string', doc: 'Quita los saltos de línea del final.' },
  endswith: { sig: 'endswith(str string, suffix string) bool', doc: 'true si el texto termina por suffix.' },
  format: { sig: 'format(spec string, values...) string', doc: 'Formatea valores al estilo printf: format("%s-%03d", "web", 7).' },
  formatlist: { sig: 'formatlist(spec string, lists...) list(string)', doc: 'Como format, aplicado a cada elemento de las listas.' },
  indent: { sig: 'indent(spaces number, str string) string', doc: 'Sangra todas las líneas menos la primera.' },
  join: { sig: 'join(separator string, list list(string)) string', doc: 'Une los elementos de una lista con un separador.' },
  lower: { sig: 'lower(str string) string', doc: 'Pasa el texto a minúsculas.' },
  regex: { sig: 'regex(pattern string, str string) any', doc: 'Primera coincidencia de una expresión regular (error si no hay).' },
  regexall: { sig: 'regexall(pattern string, str string) list', doc: 'Todas las coincidencias de una expresión regular.' },
  replace: { sig: 'replace(str string, substr string, replace string) string', doc: 'Reemplaza texto; substr entre barras (/…/) es una expresión regular.' },
  split: { sig: 'split(separator string, str string) list(string)', doc: 'Divide un texto por un separador.' },
  startswith: { sig: 'startswith(str string, prefix string) bool', doc: 'true si el texto empieza por prefix.' },
  strcontains: { sig: 'strcontains(str string, substr string) bool', doc: 'true si el texto contiene substr.' },
  strrev: { sig: 'strrev(str string) string', doc: 'Invierte el texto.' },
  substr: { sig: 'substr(str string, offset number, length number) string', doc: 'Extrae parte de un texto (length -1: hasta el final).' },
  title: { sig: 'title(str string) string', doc: 'Pone en mayúscula la primera letra de cada palabra.' },
  trim: { sig: 'trim(str string, cutset string) string', doc: 'Quita del principio y del final los caracteres de cutset.' },
  trimprefix: { sig: 'trimprefix(str string, prefix string) string', doc: 'Quita un prefijo si está.' },
  trimsuffix: { sig: 'trimsuffix(str string, suffix string) string', doc: 'Quita un sufijo si está.' },
  trimspace: { sig: 'trimspace(str string) string', doc: 'Quita los espacios del principio y del final.' },
  upper: { sig: 'upper(str string) string', doc: 'Pasa el texto a mayúsculas.' },

  // collections
  alltrue: { sig: 'alltrue(list list(bool)) bool', doc: 'true si todos los elementos son true (o la lista está vacía).' },
  anytrue: { sig: 'anytrue(list list(bool)) bool', doc: 'true si algún elemento es true.' },
  chunklist: { sig: 'chunklist(list list, size number) list(list)', doc: 'Parte una lista en trozos de tamaño size.' },
  coalesce: { sig: 'coalesce(values...) any', doc: 'El primer argumento que no es null ni "".' },
  coalescelist: { sig: 'coalescelist(lists...) list', doc: 'La primera lista que no está vacía.' },
  compact: { sig: 'compact(list list(string)) list(string)', doc: 'Quita los elementos null y "".' },
  concat: { sig: 'concat(lists...) list', doc: 'Concatena listas.' },
  contains: { sig: 'contains(list list, value any) bool', doc: 'true si la lista (o conjunto) contiene el valor.' },
  distinct: { sig: 'distinct(list list) list', doc: 'Quita los duplicados, conservando el orden.' },
  element: { sig: 'element(list list, index number) any', doc: 'Elemento en la posición index; da la vuelta si se pasa del final.' },
  flatten: { sig: 'flatten(list list) list', doc: 'Aplana listas anidadas en una sola.' },
  index: { sig: 'index(list list, value any) number', doc: 'Posición del primer elemento igual a value.' },
  keys: { sig: 'keys(map map) list(string)', doc: 'Claves de un mapa u objeto, ordenadas.' },
  length: { sig: 'length(value list|map|string) number', doc: 'Número de elementos (o de caracteres).' },
  lookup: { sig: 'lookup(map map, key string, default any) any', doc: 'Valor de una clave del mapa, o default si no existe.' },
  matchkeys: { sig: 'matchkeys(values list, keys list, searchset list) list', doc: 'Elementos de values cuya clave (en keys) está en searchset.' },
  merge: { sig: 'merge(maps...) map', doc: 'Combina mapas u objetos; ganan los últimos.' },
  one: { sig: 'one(list list) any', doc: 'El único elemento de la lista, null si está vacía (error si hay más).' },
  range: { sig: 'range(start number, limit number, step number) list(number)', doc: 'Lista de números: range(3) → [0, 1, 2].' },
  reverse: { sig: 'reverse(list list) list', doc: 'Invierte el orden de una lista.' },
  setintersection: { sig: 'setintersection(sets...) set', doc: 'Elementos comunes a todos los conjuntos.' },
  setproduct: { sig: 'setproduct(sets...) list', doc: 'Producto cartesiano: todas las combinaciones.' },
  setsubtract: { sig: 'setsubtract(a set, b set) set', doc: 'Elementos de a que no están en b.' },
  setunion: { sig: 'setunion(sets...) set', doc: 'Unión de conjuntos.' },
  slice: { sig: 'slice(list list, start number, end number) list', doc: 'Sublista desde start (incluido) hasta end (excluido).' },
  sort: { sig: 'sort(list list(string)) list(string)', doc: 'Ordena una lista de textos.' },
  transpose: { sig: 'transpose(map map(list(string))) map(list(string))', doc: 'Intercambia claves y valores de un mapa de listas.' },
  values: { sig: 'values(map map) list', doc: 'Valores de un mapa u objeto, en el orden de sus claves.' },
  zipmap: { sig: 'zipmap(keys list(string), values list) map', doc: 'Construye un mapa a partir de una lista de claves y otra de valores.' },

  // encoding
  base64decode: { sig: 'base64decode(str string) string', doc: 'Decodifica Base64.' },
  base64encode: { sig: 'base64encode(str string) string', doc: 'Codifica en Base64.' },
  base64gzip: { sig: 'base64gzip(str string) string', doc: 'Comprime con gzip y codifica en Base64.' },
  csvdecode: { sig: 'csvdecode(str string) list(map(string))', doc: 'Convierte un CSV (con cabecera) en una lista de mapas.' },
  jsondecode: { sig: 'jsondecode(str string) any', doc: 'Convierte un texto JSON en un valor.' },
  jsonencode: { sig: 'jsonencode(value any) string', doc: 'Convierte un valor en JSON (muy usado en políticas IAM).' },
  urlencode: { sig: 'urlencode(str string) string', doc: 'Codifica un texto para usarlo en una URL.' },
  yamldecode: { sig: 'yamldecode(str string) any', doc: 'Convierte un texto YAML en un valor.' },
  yamlencode: { sig: 'yamlencode(value any) string', doc: 'Convierte un valor en YAML.' },

  // filesystem
  abspath: { sig: 'abspath(path string) string', doc: 'Ruta absoluta.' },
  basename: { sig: 'basename(path string) string', doc: 'Último elemento de una ruta.' },
  dirname: { sig: 'dirname(path string) string', doc: 'Ruta sin el último elemento.' },
  file: { sig: 'file(path string) string', doc: 'Contenido de un fichero (de los abiertos en el editor).' },
  filebase64: { sig: 'filebase64(path string) string', doc: 'Contenido de un fichero en Base64.' },
  fileexists: { sig: 'fileexists(path string) bool', doc: 'true si el fichero existe.' },
  filemd5: { sig: 'filemd5(path string) string', doc: 'MD5 del contenido de un fichero.' },
  fileset: { sig: 'fileset(path string, pattern string) set(string)', doc: 'Ficheros que cumplen un patrón (*, **, ?).' },
  filesha256: { sig: 'filesha256(path string) string', doc: 'SHA-256 del contenido de un fichero.' },
  pathexpand: { sig: 'pathexpand(path string) string', doc: 'Expande ~ al directorio del usuario.' },
  templatefile: { sig: 'templatefile(path string, vars object) string', doc: 'Lee un fichero como plantilla y sustituye ${…} con vars.' },

  // date and time
  formatdate: { sig: 'formatdate(spec string, timestamp string) string', doc: 'Formatea una fecha RFC 3339: formatdate("YYYY-MM-DD", timestamp()).' },
  plantimestamp: { sig: 'plantimestamp() string', doc: 'Fecha y hora del plan (RFC 3339), conocida ya en el plan.' },
  timeadd: { sig: 'timeadd(timestamp string, duration string) string', doc: 'Suma una duración ("1h30m") a una fecha.' },
  timestamp: { sig: 'timestamp() string', doc: 'Fecha y hora actuales en UTC (RFC 3339); cambia en cada apply.' },

  // hash and crypto
  base64sha256: { sig: 'base64sha256(str string) string', doc: 'SHA-256 codificado en Base64.' },
  base64sha512: { sig: 'base64sha512(str string) string', doc: 'SHA-512 codificado en Base64.' },
  md5: { sig: 'md5(str string) string', doc: 'Hash MD5 en hexadecimal.' },
  sha1: { sig: 'sha1(str string) string', doc: 'Hash SHA-1 en hexadecimal.' },
  sha256: { sig: 'sha256(str string) string', doc: 'Hash SHA-256 en hexadecimal.' },
  sha512: { sig: 'sha512(str string) string', doc: 'Hash SHA-512 en hexadecimal.' },
  uuid: { sig: 'uuid() string', doc: 'UUID aleatorio; cambia en cada apply.' },

  // IP network
  cidrhost: { sig: 'cidrhost(prefix string, hostnum number) string', doc: 'Dirección IP del host número hostnum dentro del rango.' },
  cidrnetmask: { sig: 'cidrnetmask(prefix string) string', doc: 'Máscara de red de un rango IPv4: "255.255.0.0".' },
  cidrsubnet: { sig: 'cidrsubnet(prefix string, newbits number, netnum number) string', doc: 'Subred: cidrsubnet("10.0.0.0/16", 8, 1) → "10.0.1.0/24".' },
  cidrsubnets: { sig: 'cidrsubnets(prefix string, newbits...) list(string)', doc: 'Varias subredes consecutivas, una por cada newbits.' },

  // type conversion
  can: { sig: 'can(expression) bool', doc: 'true si la expresión se evalúa sin errores.' },
  issensitive: { sig: 'issensitive(value any) bool', doc: 'true si el valor es sensible.' },
  nonsensitive: { sig: 'nonsensitive(value any) any', doc: 'Quita la marca de sensible a un valor.' },
  sensitive: { sig: 'sensitive(value any) any', doc: 'Marca un valor como sensible: no se muestra en el plan.' },
  tobool: { sig: 'tobool(value any) bool', doc: 'Convierte a bool.' },
  tolist: { sig: 'tolist(value any) list', doc: 'Convierte a lista.' },
  tomap: { sig: 'tomap(value any) map', doc: 'Convierte a mapa.' },
  tonumber: { sig: 'tonumber(value any) number', doc: 'Convierte a número.' },
  toset: { sig: 'toset(value any) set', doc: 'Convierte a conjunto (sin duplicados ni orden); útil con for_each.' },
  tostring: { sig: 'tostring(value any) string', doc: 'Convierte a texto.' },
  try: { sig: 'try(expressions...) any', doc: 'El valor de la primera expresión que no da error.' },
};
