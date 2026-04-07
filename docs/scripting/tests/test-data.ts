import type { TestConfig } from '@site/src/components/test/types';

export const testFundamentos: TestConfig = {
  id: 'sh-fundamentos',
  title: 'Fundamentos de Bash',
  numberOfQuestions: 10,
  time: 15,
  pointsType: 'over10',
  minForPass: 6,
  onTimeUp: 'warn',
  questions: [
    {
      id: 'fund-1',
      title: '¿Qué indica la línea `#!/bin/bash` al principio de un script?',
      type: 'select',
      points: 1,
      answers: [
        'Es un comentario descriptivo que documenta el autor del script',
        'Indica al sistema operativo qué intérprete debe usar para ejecutar el script',
        'Define una variable de entorno que apunta al binario de Bash',
        'Activa el modo estricto de ejecución del script',
      ],
      correctAnswer: 1,
      explanation:
        'El shebang (#!) en la primera línea indica al kernel del sistema operativo qué intérprete debe invocar para ejecutar el script. En este caso, /bin/bash.',
    },
    {
      id: 'fund-2',
      title: '¿Cuál es la diferencia entre `$var` y `${var}` en Bash?',
      type: 'select',
      points: 1,
      answers: [
        '`${var}` ejecuta el valor de la variable como un comando',
        'No hay diferencia, son completamente equivalentes en todos los contextos',
        '`${var}` permite delimitar el nombre de la variable para evitar ambigüedades, como en `${var}_sufijo`',
        '`${var}` solo funciona dentro de funciones, `$var` es global',
      ],
      correctAnswer: 2,
      explanation:
        'Las llaves permiten delimitar el nombre de la variable. Sin ellas, `$var_sufijo` buscaría una variable llamada `var_sufijo`. Con `${var}_sufijo`, Bash sabe que la variable es `var` y `_sufijo` es texto literal.',
    },
    {
      id: 'fund-3',
      title: '¿Qué produce el siguiente código?\n\n```bash\nnombre="mundo"\necho \'Hola $nombre\'\n```',
      type: 'select',
      points: 1,
      answers: [
        'Hola mundo',
        'Hola $nombre',
        'Un error de sintaxis',
        'Hola (seguido de una línea vacía)',
      ],
      correctAnswer: 1,
      explanation:
        'Las comillas simples preservan el texto de forma literal: no se expanden variables, ni caracteres de escape, ni sustituciones de comandos. Por eso se imprime literalmente `Hola $nombre`.',
    },
    {
      id: 'fund-4',
      title: '¿Qué valor contiene la variable especial `$?` tras ejecutar un comando?',
      type: 'select',
      points: 1,
      answers: [
        'El PID del último proceso en background',
        'El número total de argumentos del script',
        'El código de salida (exit code) del último comando ejecutado',
        'El nombre del script que se está ejecutando',
      ],
      correctAnswer: 2,
      explanation:
        '`$?` almacena el código de salida del último comando ejecutado. Un valor de 0 indica éxito y cualquier otro valor indica un error.',
    },
    {
      id: 'fund-5',
      title: '¿Qué diferencia hay entre `$@` y `$*` cuando se usan entre comillas dobles?',
      type: 'select',
      points: 2,
      answers: [
        'No hay diferencia, ambos expanden todos los argumentos posicionales',
        '`"$@"` expande cada argumento como una palabra separada, `"$*"` los une en una sola cadena',
        '`"$*"` expande cada argumento como una palabra separada, `"$@"` los une en una sola cadena',
        '`"$@"` excluye el primer argumento ($0), mientras que `"$*"` lo incluye',
      ],
      correctAnswer: 1,
      explanation:
        'Entre comillas dobles, `"$@"` expande cada argumento posicional como una palabra independiente (preservando argumentos con espacios), mientras que `"$*"` los concatena en una sola cadena separada por el primer carácter de IFS.',
    },
    {
      id: 'fund-6',
      title: '¿Cuál es la forma correcta de capturar la salida de un comando en una variable?',
      type: 'select',
      points: 1,
      answers: [
        'fecha = $(date +%Y-%m-%d)',
        'fecha=$(date +%Y-%m-%d)',
        'fecha=`date +%Y-%m-%d`',
        'Las opciones B y C son ambas válidas',
      ],
      correctAnswer: 3,
      explanation:
        'Tanto `$(...)` como las comillas invertidas (backticks) capturan la salida de un comando. Sin embargo, `$(...)` es la forma moderna y recomendada porque permite anidamiento. La opción A falla porque Bash no permite espacios alrededor del `=` en asignaciones.',
    },
    {
      id: 'fund-7',
      title: '¿Qué imprime el siguiente código?\n\n```bash\narr=(alpha beta gamma)\necho ${#arr[@]}\n```',
      type: 'select',
      points: 1,
      answers: [
        'alpha beta gamma',
        'alpha',
        '3',
        '5',
      ],
      correctAnswer: 2,
      explanation:
        '`${#arr[@]}` devuelve el número de elementos del array. En este caso el array tiene 3 elementos: alpha, beta y gamma.',
    },
    {
      id: 'fund-8',
      title: '¿Cuáles de las siguientes son shells compatibles con POSIX?',
      type: 'multiselect',
      points: 2,
      answers: [
        'dash',
        'bash (en modo POSIX)',
        'fish',
        'ksh',
        'zsh (en modo POSIX)',
      ],
      correctAnswer: [0, 1, 3, 4],
      explanation:
        'dash, bash (con --posix), ksh y zsh (con emulate sh) son compatibles con POSIX. fish usa una sintaxis propia e incompatible con POSIX por diseño.',
    },
    {
      id: 'fund-9',
      title: '¿Qué resultado produce `echo $((5 / 2))` en Bash?',
      type: 'select',
      points: 1,
      answers: [
        '2.5',
        '2',
        '3',
        'Un error porque Bash no soporta aritmética',
      ],
      correctAnswer: 1,
      explanation:
        'La expansión aritmética `$((...))` en Bash solo opera con enteros. La división 5/2 produce 2, descartando la parte decimal. Para aritmética con decimales se necesita `bc` u otra herramienta externa.',
    },
    {
      id: 'fund-10',
      title: '¿Qué ocurre al ejecutar este script?\n\n```bash\nreadonly CONF="/etc/app.conf"\nCONF="/tmp/app.conf"\necho $CONF\n```',
      type: 'select',
      points: 1,
      answers: [
        'Imprime /tmp/app.conf',
        'Imprime /etc/app.conf sin errores',
        'Produce un error al intentar reasignar una variable de solo lectura',
        'Imprime ambas rutas en líneas separadas',
      ],
      correctAnswer: 2,
      explanation:
        '`readonly` marca la variable como inmutable. Intentar reasignarla produce un error: "bash: CONF: readonly variable". El script falla en la segunda línea.',
    },
  ],
};

export const testEstructurasControl: TestConfig = {
  id: 'sh-control',
  title: 'Estructuras de Control y Funciones',
  numberOfQuestions: 10,
  time: 15,
  pointsType: 'over10',
  minForPass: 6,
  onTimeUp: 'warn',
  questions: [
    {
      id: 'ctrl-1',
      title: '¿Cuál es la diferencia principal entre `[ ]` y `[[ ]]` en Bash?',
      type: 'select',
      points: 1,
      answers: [
        '`[ ]` es más moderno y soporta regex, `[[ ]]` es la versión POSIX',
        '`[[ ]]` es una palabra clave de Bash que soporta operadores como `&&`, `||` y `=~`, mientras que `[ ]` es un comando externo POSIX',
        'No hay diferencia, son alias del mismo comando',
        '`[[ ]]` solo funciona con comparaciones numéricas',
      ],
      correctAnswer: 1,
      explanation:
        '`[[ ]]` es una palabra clave integrada de Bash que permite `&&`, `||`, coincidencia de patrones glob y regex (`=~`), y no requiere escapar operadores. `[ ]` (o `test`) es un comando POSIX compatible pero más limitado.',
    },
    {
      id: 'ctrl-2',
      title: '¿Qué imprime este código?\n\n```bash\nx=5\nif [[ $x -gt 3 && $x -lt 10 ]]; then\n  echo "rango"\nelse\n  echo "fuera"\nfi\n```',
      type: 'select',
      points: 1,
      answers: [
        'fuera',
        'rango',
        'Un error de sintaxis por usar && dentro de [[ ]]',
        'No imprime nada',
      ],
      correctAnswer: 1,
      explanation:
        '`$x` vale 5, que es mayor que 3 y menor que 10. La condición se cumple y se imprime "rango". El operador `&&` funciona correctamente dentro de `[[ ]]`.',
    },
    {
      id: 'ctrl-3',
      title: '¿Qué operador se usa en `[[ ]]` para comprobar si un archivo existe y es un directorio?',
      type: 'select',
      points: 1,
      answers: [
        '-f',
        '-e',
        '-d',
        '-r',
      ],
      correctAnswer: 2,
      explanation:
        '`-d` comprueba si la ruta existe y es un directorio. `-f` comprueba si es un archivo regular, `-e` comprueba existencia sin importar el tipo, y `-r` comprueba si tiene permiso de lectura.',
    },
    {
      id: 'ctrl-4',
      title: '¿Qué produce el siguiente script?\n\n```bash\ncase "deploy-prod" in\n  deploy-*) echo "desplegando" ;;\n  test-*)   echo "testeando" ;;\n  *)        echo "desconocido" ;;\nesac\n```',
      type: 'select',
      points: 1,
      answers: [
        'desconocido',
        'desplegando',
        'testeando',
        'Un error porque el guión no es válido en patrones case',
      ],
      correctAnswer: 1,
      explanation:
        'El patrón `deploy-*` coincide con "deploy-prod" gracias al glob `*`. El `case` ejecuta el primer bloque que coincida y se detiene al encontrar `;;`.',
    },
    {
      id: 'ctrl-5',
      title: '¿Qué imprime este código?\n\n```bash\nfor i in {1..5}; do\n  [[ $i -eq 3 ]] && continue\n  printf "%s " "$i"\ndone\n```',
      type: 'select',
      points: 1,
      answers: [
        '1 2 3 4 5',
        '1 2 4 5',
        '1 2',
        '3',
      ],
      correctAnswer: 1,
      explanation:
        '`continue` salta a la siguiente iteración del bucle sin ejecutar el resto del cuerpo. Cuando `$i` vale 3, se salta el `printf` y se pasa a la iteración con `$i=4`. Se imprimen todos los números excepto el 3.',
    },
    {
      id: 'ctrl-6',
      title: '¿Qué valor tendrá `resultado` tras ejecutar este código?\n\n```bash\ncontar() {\n  local n=0\n  for f in "$@"; do\n    [[ -f "$f" ]] && ((n++))\n  done\n  return $n\n}\ncontar /etc/passwd /etc/hosts /no/existe\nresultado=$?\n```',
      type: 'select',
      points: 2,
      answers: [
        '0',
        '1',
        '2',
        '3',
      ],
      correctAnswer: 2,
      explanation:
        'La función cuenta archivos regulares que existen. `/etc/passwd` y `/etc/hosts` existen como archivos regulares, `/no/existe` no. La función retorna 2 con `return`, y `$?` captura ese valor.',
    },
    {
      id: 'ctrl-7',
      title: '¿Qué efecto tiene la palabra clave `local` dentro de una función Bash?',
      type: 'select',
      points: 1,
      answers: [
        'Hace que la variable sea de solo lectura dentro de la función',
        'Limita el alcance de la variable a la función donde se declara',
        'Exporta la variable al entorno de subprocesos',
        'Convierte la variable en un array asociativo',
      ],
      correctAnswer: 1,
      explanation:
        '`local` restringe el alcance de la variable a la función actual y sus funciones hijas. Sin `local`, las variables en funciones son globales al script, lo que puede causar efectos secundarios difíciles de depurar.',
    },
    {
      id: 'ctrl-8',
      title: '¿Qué imprime este código?\n\n```bash\nfalse || echo "A"\ntrue && echo "B"\nfalse && echo "C"\n```',
      type: 'multiselect',
      points: 2,
      answers: [
        'A',
        'B',
        'C',
      ],
      correctAnswer: [0, 1],
      explanation:
        '`||` ejecuta el lado derecho si el izquierdo falla: `false` falla, se imprime "A". `&&` ejecuta el lado derecho si el izquierdo tiene éxito: `true` tiene éxito, se imprime "B". `false && echo "C"`: `false` falla, "C" no se imprime.',
    },
    {
      id: 'ctrl-9',
      title: '¿Cuál es el código de salida convencional en Linux para indicar que un comando terminó con éxito?',
      type: 'select',
      points: 1,
      answers: [
        '1',
        '-1',
        '0',
        '255',
      ],
      correctAnswer: 2,
      explanation:
        'Por convención en Linux/Unix, un código de salida 0 indica éxito. Cualquier valor entre 1 y 255 indica algún tipo de error o condición especial.',
    },
    {
      id: 'ctrl-10',
      title: '¿Qué ocurre con el siguiente `while` loop?\n\n```bash\ncount=0\nwhile read -r linea; do\n  ((count++))\ndone < /etc/passwd\necho "$count"\n```',
      type: 'select',
      points: 1,
      answers: [
        'Entra en un bucle infinito porque /etc/passwd nunca cambia',
        'Lee /etc/passwd línea a línea e imprime el número total de líneas',
        'Falla porque `read` no puede leer archivos, solo stdin interactivo',
        'Imprime 0 porque la redirección no funciona con while',
      ],
      correctAnswer: 1,
      explanation:
        'La redirección `< /etc/passwd` alimenta el stdin del bucle `while read`. Cada iteración lee una línea e incrementa el contador. Cuando se acaba el archivo, `read` retorna un código distinto de 0 y el bucle termina. Se imprime el número total de líneas.',
    },
  ],
};

export const testPipesHerramientas: TestConfig = {
  id: 'sh-pipes',
  title: 'Pipes y Herramientas de Texto',
  numberOfQuestions: 10,
  time: 15,
  pointsType: 'over10',
  minForPass: 6,
  onTimeUp: 'warn',
  questions: [
    {
      id: 'pipes-1',
      title: '¿Qué hace la redirección `2>&1` en un comando Bash?',
      type: 'select',
      points: 1,
      answers: [
        'Redirige stdin al archivo descriptor 1',
        'Redirige stderr (fd 2) al mismo destino que stdout (fd 1)',
        'Redirige stdout al archivo llamado "1"',
        'Duplica el proceso en dos subshells',
      ],
      correctAnswer: 1,
      explanation:
        '`2>&1` redirige el file descriptor 2 (stderr) al mismo destino que el file descriptor 1 (stdout). Es útil para capturar tanto la salida normal como los errores en un mismo flujo.',
    },
    {
      id: 'pipes-2',
      title: '¿Cuál es la diferencia entre `>` y `>>` en una redirección?',
      type: 'select',
      points: 1,
      answers: [
        '`>` añade contenido al final del archivo, `>>` lo sobrescribe',
        '`>` sobrescribe el archivo, `>>` añade contenido al final (append)',
        '`>` solo funciona con archivos nuevos, `>>` con archivos existentes',
        '`>>` redirige stderr, `>` redirige stdout',
      ],
      correctAnswer: 1,
      explanation:
        '`>` trunca el archivo y escribe desde el principio (sobrescribe). `>>` abre el archivo en modo append y añade el contenido al final sin borrar lo existente.',
    },
    {
      id: 'pipes-3',
      title: '¿Qué produce el siguiente comando?\n\n```bash\necho "ERROR: disco lleno" | grep -ci "error"\n```',
      type: 'select',
      points: 1,
      answers: [
        'ERROR: disco lleno',
        '1',
        'error',
        '0',
      ],
      correctAnswer: 1,
      explanation:
        '`grep -c` cuenta el número de líneas que coinciden (no el número de coincidencias). `-i` hace la búsqueda case-insensitive. Hay una línea que contiene "error" (ignorando mayúsculas), así que el resultado es 1.',
    },
    {
      id: 'pipes-4',
      title: '¿Qué produce este pipeline?\n\n```bash\necho "uno:dos:tres" | awk -F: \'{print $2}\'\n```',
      type: 'select',
      points: 1,
      answers: [
        'uno',
        'dos',
        'tres',
        'uno:dos:tres',
      ],
      correctAnswer: 1,
      explanation:
        '`awk -F:` establece los dos puntos como separador de campos. `$2` se refiere al segundo campo. Con la entrada "uno:dos:tres", los campos son: $1=uno, $2=dos, $3=tres. Se imprime "dos".',
    },
    {
      id: 'pipes-5',
      title: '¿Qué hace el siguiente comando `sed`?\n\n```bash\necho "Hola Mundo Hola" | sed \'s/Hola/Adiós/\'\n```',
      type: 'select',
      points: 1,
      answers: [
        'Adiós Mundo Adiós',
        'Adiós Mundo Hola',
        'Hola Mundo Adiós',
        'Produce un error de sintaxis',
      ],
      correctAnswer: 1,
      explanation:
        'Sin el flag `g` (global), `sed s/patrón/reemplazo/` solo sustituye la primera ocurrencia en cada línea. La primera "Hola" se reemplaza por "Adiós", pero la segunda permanece. Para reemplazar todas se usaría `s/Hola/Adiós/g`.',
    },
    {
      id: 'pipes-6',
      title: '¿Qué comando extrae el campo `name` del siguiente JSON usando `jq`?\n\n```json\n{"user": {"name": "Ana", "age": 30}}\n```',
      type: 'select',
      points: 1,
      answers: [
        'jq ".name"',
        'jq ".user.name"',
        'jq ".user[name]"',
        'jq "user.name"',
      ],
      correctAnswer: 1,
      explanation:
        'En `jq`, se accede a campos anidados encadenando el operador punto: `.user.name` navega primero al objeto `user` y luego extrae el campo `name`. El punto inicial es obligatorio.',
    },
    {
      id: 'pipes-7',
      title: '¿Cuáles de las siguientes expresiones regulares coinciden con la cadena `error404`?',
      type: 'multiselect',
      points: 2,
      answers: [
        'error[0-9]+',
        'error.*',
        '^error[0-9]{3}$',
        'Error404',
        'err.r[0-9]*',
      ],
      correctAnswer: [0, 1, 2, 4],
      explanation:
        '`error[0-9]+` coincide (letras + uno o más dígitos). `error.*` coincide (letras + cualquier cosa). `^error[0-9]{3}$` coincide (exactamente 3 dígitos tras error). `err.r[0-9]*` coincide (el punto coincide con cualquier carácter, incluida la "o"). `Error404` no coincide porque regex es case-sensitive por defecto.',
    },
    {
      id: 'pipes-8',
      title: '¿Qué produce el siguiente pipeline?\n\n```bash\nprintf "b\\na\\nc\\na\\n" | sort | uniq -c | sort -rn | head -1\n```',
      type: 'select',
      points: 2,
      answers: [
        '2 a',
        '1 b',
        'a',
        '1 a',
      ],
      correctAnswer: 0,
      explanation:
        'El pipeline: 1) imprime b,a,c,a en líneas separadas, 2) `sort` las ordena (a,a,b,c), 3) `uniq -c` cuenta las consecutivas (2 a, 1 b, 1 c), 4) `sort -rn` ordena numéricamente en reversa (2 a primero), 5) `head -1` toma la primera línea. Resultado: "2 a" (con espacios de formato).',
    },
    {
      id: 'pipes-9',
      title: '¿Qué ocurre con stderr al ejecutar `comando 2>/dev/null`?',
      type: 'select',
      points: 1,
      answers: [
        'stderr se redirige a stdout',
        'stderr se descarta por completo, enviándolo a /dev/null',
        'Se crea un archivo llamado /dev/null con los errores',
        'El comando se ejecuta en modo silencioso, suprimiendo también stdout',
      ],
      correctAnswer: 1,
      explanation:
        '`/dev/null` es un dispositivo especial que descarta todo lo que se escribe en él. `2>/dev/null` redirige stderr (fd 2) a este dispositivo, eliminando los mensajes de error. stdout no se ve afectado.',
    },
    {
      id: 'pipes-10',
      title: '¿Qué flag de `grep` se usa para buscar patrones como expresiones regulares extendidas sin necesidad de escapar `+`, `?` y `|`?',
      type: 'select',
      points: 1,
      answers: [
        '-P (perl regex)',
        '-F (fixed string)',
        '-E (extended regex)',
        '-w (word match)',
      ],
      correctAnswer: 2,
      explanation:
        '`grep -E` (o `egrep`) activa las expresiones regulares extendidas, donde operadores como `+`, `?`, `|` y `()` no necesitan ser escapados con barra invertida. `-P` activa regex Perl (no disponible en todas las plataformas), `-F` trata el patrón como texto literal.',
    },
  ],
};

export const testAutomatizacion: TestConfig = {
  id: 'sh-auto',
  title: 'Automatización y Manejo de Errores',
  numberOfQuestions: 10,
  time: 15,
  pointsType: 'over10',
  minForPass: 6,
  onTimeUp: 'warn',
  questions: [
    {
      id: 'auto-1',
      title: '¿Qué efecto tiene `set -e` en un script Bash?',
      type: 'select',
      points: 1,
      answers: [
        'Activa el modo de depuración, mostrando cada comando antes de ejecutarlo',
        'Hace que el script termine inmediatamente si cualquier comando retorna un código de salida distinto de 0',
        'Exporta todas las variables al entorno de los subprocesos',
        'Desactiva la expansión de glob en nombres de archivos',
      ],
      correctAnswer: 1,
      explanation:
        '`set -e` (o `set -o errexit`) hace que el script se detenga inmediatamente cuando un comando falla (retorna un exit code distinto de 0), evitando que errores silenciosos se propaguen.',
    },
    {
      id: 'auto-2',
      title: '¿Qué hace cada flag en `set -euo pipefail`?',
      type: 'multiselect',
      points: 2,
      answers: [
        '`-e`: aborta el script si un comando falla',
        '`-u`: trata las variables no definidas como error',
        '`-o pipefail`: hace que un pipeline falle si cualquier comando del pipe falla',
        '`-u`: desactiva la expansión Unicode en cadenas',
        '`-o pipefail`: ejecuta los comandos del pipe en paralelo',
      ],
      correctAnswer: [0, 1, 2],
      explanation:
        '`-e` aborta en errores, `-u` trata variables indefinidas como error (en vez de expandirlas como cadena vacía), y `-o pipefail` hace que el código de salida de un pipeline sea el del último comando que falle, no solo el del último comando.',
    },
    {
      id: 'auto-3',
      title: '¿Qué hace el comando `trap cleanup EXIT` en un script?',
      type: 'select',
      points: 1,
      answers: [
        'Define un alias llamado cleanup que ejecuta el comando exit',
        'Ejecuta la función `cleanup` cuando el script termina, sin importar si fue por éxito, error o señal',
        'Captura la señal SIGKILL y ejecuta cleanup antes de morir',
        'Impide que el script pueda terminar hasta que cleanup se ejecute manualmente',
      ],
      correctAnswer: 1,
      explanation:
        '`trap` registra un handler para señales o pseudoseñales. `EXIT` es una pseudoseñal que se dispara cuando el script termina por cualquier razón (éxito, error, señal). Es ideal para limpiar archivos temporales o liberar recursos.',
    },
    {
      id: 'auto-4',
      title: '¿Qué herramienta se recomienda para detectar errores comunes y malas prácticas en scripts Bash antes de ejecutarlos?',
      type: 'select',
      points: 1,
      answers: [
        'bash --check',
        'shellcheck',
        'bash -n (solo verifica sintaxis)',
        'lint-bash',
      ],
      correctAnswer: 1,
      explanation:
        'ShellCheck es el linter estándar de la industria para scripts shell. Detecta errores comunes, variables sin comillas, uso incorrecto de arrays, compatibilidad POSIX y muchos más problemas que `bash -n` no puede detectar (este solo verifica sintaxis).',
    },
    {
      id: 'auto-5',
      title: '¿Qué produce el siguiente script?\n\n```bash\nset -u\necho "Valor: $VARIABLE_INEXISTENTE"\necho "Fin"\n```',
      type: 'select',
      points: 1,
      answers: [
        'Imprime "Valor: " (vacío) y luego "Fin"',
        'Imprime "Valor: $VARIABLE_INEXISTENTE" literalmente',
        'El script falla con un error de variable no definida y no llega a imprimir "Fin"',
        'Imprime "Valor: null" y luego "Fin"',
      ],
      correctAnswer: 2,
      explanation:
        'Con `set -u` (nounset), usar una variable no definida es un error fatal. El script aborta al intentar expandir `$VARIABLE_INEXISTENTE` y nunca ejecuta el segundo `echo`.',
    },
    {
      id: 'auto-6',
      title: '¿Qué expresa la siguiente expresión cron? `30 2 * * 1-5`',
      type: 'select',
      points: 1,
      answers: [
        'Cada 30 minutos, de las 2 a las 5 de la mañana, todos los días',
        'A las 2:30 AM, de lunes a viernes',
        'A las 2:30 AM, los días 1 al 5 de cada mes',
        'Cada 2 horas y 30 minutos, los viernes',
      ],
      correctAnswer: 1,
      explanation:
        'Formato cron: minuto hora día-del-mes mes día-de-la-semana. `30 2 * * 1-5` significa: minuto 30, hora 2, cualquier día del mes, cualquier mes, lunes (1) a viernes (5).',
    },
    {
      id: 'auto-7',
      title: '¿Qué hace `set -x` en un script Bash?',
      type: 'select',
      points: 1,
      answers: [
        'Desactiva la ejecución de comandos (dry run)',
        'Muestra cada comando y sus argumentos expandidos en stderr antes de ejecutarlos',
        'Activa el modo exclusivo, impidiendo ejecuciones paralelas del mismo script',
        'Exporta todas las variables al entorno',
      ],
      correctAnswer: 1,
      explanation:
        '`set -x` (o `set -o xtrace`) imprime en stderr cada comando antes de ejecutarlo, con las variables ya expandidas (prefijado con `+`). Es muy útil para depuración. Se puede desactivar con `set +x`.',
    },
    {
      id: 'auto-8',
      title: '¿Cuál es la forma correcta de crear un directorio temporal de forma segura en un script?',
      type: 'select',
      points: 1,
      answers: [
        'mkdir /tmp/mi_script_tmp',
        'TMPDIR=$(mktemp -d)',
        'export TMP="/tmp/$$"',
        'touch /tmp/tempfile_$(date +%s)',
      ],
      correctAnswer: 1,
      explanation:
        '`mktemp -d` crea un directorio temporal con un nombre único y permisos seguros (solo accesible por el usuario). Usar rutas fijas como `/tmp/mi_script_tmp` es inseguro por posibles race conditions y conflictos de nombre.',
    },
    {
      id: 'auto-9',
      title: '¿Qué imprime este script?\n\n```bash\nset -o pipefail\nfalse | true | true\necho $?\n```',
      type: 'select',
      points: 2,
      answers: [
        '0',
        '1',
        '127',
        'No imprime nada porque el script aborta antes',
      ],
      correctAnswer: 1,
      explanation:
        'Sin `pipefail`, el código de salida de un pipeline es el del último comando (`true` = 0). Con `pipefail`, es el del último comando que falle. `false` retorna 1, así que el pipeline retorna 1. No se usa `set -e`, así que el script no aborta.',
    },
    {
      id: 'auto-10',
      title: '¿Cuál es una buena práctica para la creación de backups automatizados con un script Bash?',
      type: 'select',
      points: 1,
      answers: [
        'Sobrescribir siempre el mismo archivo de backup para ahorrar espacio',
        'Incluir la fecha en el nombre del archivo y aplicar una política de retención que elimine backups antiguos',
        'Ejecutar el script manualmente cada día para verificar que funciona',
        'Guardar los backups en el mismo disco que los datos originales',
      ],
      correctAnswer: 1,
      explanation:
        'Una buena práctica es nombrar los backups con timestamp (ej: `backup_2024-01-15.tar.gz`), almacenarlos en un medio diferente al original y aplicar una política de retención que elimine automáticamente los más antiguos (ej: mantener los últimos 30 días).',
    },
  ],
};

export const testScriptingPipelines: TestConfig = {
  id: 'sh-pipelines',
  title: 'Scripting en Pipelines CI/CD',
  numberOfQuestions: 10,
  time: 15,
  pointsType: 'over10',
  minForPass: 6,
  onTimeUp: 'warn',
  questions: [
    {
      id: 'pipe-1',
      title: '¿Dónde se ejecutan los comandos definidos en el bloque `run:` de un step de GitHub Actions?',
      type: 'select',
      points: 1,
      answers: [
        'En un contenedor Docker aislado gestionado por GitHub',
        'En el shell del runner (por defecto bash en Linux/macOS), directamente en la máquina virtual del workflow',
        'En los servidores de GitHub como serverless functions',
        'En el navegador del usuario que hizo push',
      ],
      correctAnswer: 1,
      explanation:
        'Los comandos de `run:` se ejecutan en el shell del runner. Por defecto, GitHub Actions usa `bash` en runners Linux/macOS y `pwsh` en Windows. Los comandos corren directamente en la VM efímera del workflow.',
    },
    {
      id: 'pipe-2',
      title: '¿Cómo se accede al nombre de la rama actual en un script dentro de GitHub Actions?',
      type: 'select',
      points: 1,
      answers: [
        'Ejecutando `git branch --current`',
        'Usando la variable de entorno `$GITHUB_REF_NAME`',
        'Leyendo el archivo `.git/HEAD`',
        'Con la variable `$BRANCH_NAME` que GitHub inyecta automáticamente',
      ],
      correctAnswer: 1,
      explanation:
        '`GITHUB_REF_NAME` contiene el nombre corto de la rama o tag que disparó el workflow. Otras variables útiles incluyen `GITHUB_SHA` (commit hash), `GITHUB_REPOSITORY` (owner/repo) y `GITHUB_EVENT_NAME` (tipo de evento).',
    },
    {
      id: 'pipe-3',
      title: '¿Cuál es la forma correcta de usar un secret en un step `run:` de GitHub Actions?',
      type: 'select',
      points: 1,
      answers: [
        'Referenciarlo directamente: `echo ${{ secrets.API_KEY }}`',
        'Pasarlo como variable de entorno del step y usarlo en el script como `$API_KEY`',
        'Leerlo del archivo `.github/secrets.yml`',
        'Los secrets no están disponibles en bloques `run:`, solo en `uses:`',
      ],
      correctAnswer: 1,
      explanation:
        'La forma recomendada es mapear el secret a una variable de entorno en la sección `env:` del step (`env: API_KEY: ${{ secrets.API_KEY }}`) y luego usar `$API_KEY` en el script. Esto evita que el secret aparezca en el YAML y en los logs.',
    },
    {
      id: 'pipe-4',
      title: '¿Qué ocurre por defecto si un comando en un step `run:` falla (exit code distinto de 0)?',
      type: 'select',
      points: 1,
      answers: [
        'El workflow continúa ejecutando los siguientes steps normalmente',
        'El step falla, los steps posteriores del job se saltan y el job se marca como failed',
        'GitHub Actions reintenta el comando hasta 3 veces automáticamente',
        'Se envía una notificación pero el workflow continúa',
      ],
      correctAnswer: 1,
      explanation:
        'GitHub Actions ejecuta los shells con `set -eo pipefail` por defecto. Si cualquier comando falla, el step falla inmediatamente, se saltan los steps restantes del job (salvo los que tengan `if: always()`), y el job se reporta como failed.',
    },
    {
      id: 'pipe-5',
      title: '¿Para qué se usa un wrapper script en un pipeline CI/CD?',
      type: 'select',
      points: 1,
      answers: [
        'Para empaquetar el código fuente en un archivo comprimido',
        'Para encapsular lógica compleja (validaciones, reintentos, formateo) que sería difícil de mantener directamente en el YAML del workflow',
        'Para reemplazar completamente el archivo de workflow YAML',
        'Para cifrar los secrets antes de usarlos en el pipeline',
      ],
      correctAnswer: 1,
      explanation:
        'Un wrapper script (ej: `scripts/deploy.sh`) encapsula lógica compleja como validaciones, manejo de errores, reintentos y logs estructurados. Mantiene el YAML del workflow limpio y permite reutilizar y testear la lógica fuera del CI/CD.',
    },
    {
      id: 'pipe-6',
      title: '¿Qué framework se usa comúnmente para escribir tests unitarios de scripts Bash?',
      type: 'select',
      points: 1,
      answers: [
        'jest-bash',
        'bats (Bash Automated Testing System)',
        'pytest-shell',
        'mocha-sh',
      ],
      correctAnswer: 1,
      explanation:
        'BATS (Bash Automated Testing System) es el framework estándar para testing de scripts Bash. Usa archivos `.bats` con funciones `@test` y helpers como `run`, `[ "$status" -eq 0 ]` y `[[ "$output" == *"expected"* ]]`.',
    },
    {
      id: 'pipe-7',
      title: '¿Cómo se puede pasar un valor de un step a otro dentro del mismo job en GitHub Actions?',
      type: 'select',
      points: 2,
      answers: [
        'Escribiendo en un archivo compartido en `/tmp`',
        'Usando `echo "nombre=valor" >> $GITHUB_OUTPUT` y leyéndolo con `${{ steps.id.outputs.nombre }}`',
        'Exportando con `export` la variable en el primer step',
        'No es posible, cada step tiene un entorno completamente aislado',
      ],
      correctAnswer: 1,
      explanation:
        'Se escribe `nombre=valor` en el archivo `$GITHUB_OUTPUT` y se referencia con `${{ steps.<id-del-step>.outputs.nombre }}`. Las variables `export` no persisten entre steps porque cada step ejecuta un nuevo proceso shell.',
    },
    {
      id: 'pipe-8',
      title: '¿Cuáles son buenas prácticas al escribir scripts para CI/CD?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Usar `set -euo pipefail` al inicio del script',
        'Hardcodear tokens y passwords directamente en el script para simplicidad',
        'Hacer que los scripts sean idempotentes (ejecutarlos varias veces produce el mismo resultado)',
        'Incluir logs claros con prefijos de timestamp o nivel (INFO, ERROR)',
        'Evitar el uso de funciones para mantener los scripts lineales y simples',
      ],
      correctAnswer: [0, 2, 3],
      explanation:
        'Los scripts CI/CD deben usar modo estricto (`set -euo pipefail`), ser idempotentes para poder reejecutar pipelines sin efectos secundarios, y producir logs claros para facilitar la depuración. Los secrets nunca se hardcodean y las funciones ayudan a organizar el código.',
    },
    {
      id: 'pipe-9',
      title: '¿Qué problema tiene este step de GitHub Actions?\n\n```yaml\n- run: |\n    if [ "$DEPLOY_ENV" = "prod" ]; then\n      ./deploy.sh --env prod\n    fi\n  env:\n    DEPLOY_ENV: ${{ github.event.inputs.environment }}\n```',
      type: 'select',
      points: 2,
      answers: [
        'La sintaxis YAML del bloque multilínea es incorrecta',
        'Si `environment` no se proporciona como input, `$DEPLOY_ENV` estará vacía y el deploy nunca se ejecutará, sin producir ningún error o aviso',
        'No se pueden usar inputs de workflow_dispatch dentro de bloques run',
        '`[ ]` no funciona en GitHub Actions, hay que usar `[[ ]]`',
      ],
      correctAnswer: 1,
      explanation:
        'Si el input `environment` no se proporciona o no existe, `$DEPLOY_ENV` será una cadena vacía. El `if` simplemente no entrará en la rama, y el step terminará con éxito sin hacer nada ni avisar. Un script robusto debería validar que la variable no esté vacía antes de continuar.',
    },
    {
      id: 'pipe-10',
      title: '¿Cuál es la ventaja principal de ejecutar ShellCheck como step en un pipeline CI/CD?',
      type: 'select',
      points: 1,
      answers: [
        'Optimiza los scripts para que se ejecuten más rápido en producción',
        'Detecta errores, malas prácticas y problemas de portabilidad en los scripts antes de que lleguen a producción',
        'Convierte automáticamente los scripts Bash en Python para mayor compatibilidad',
        'Formatea los scripts según el estándar Google Shell Style Guide',
      ],
      correctAnswer: 1,
      explanation:
        'Integrar ShellCheck en CI/CD asegura que todos los scripts del repositorio se analicen automáticamente en cada push o PR. Esto detecta errores comunes (variables sin comillas, word splitting, etc.) y malas prácticas antes de que afecten a entornos reales.',
    },
  ],
};
