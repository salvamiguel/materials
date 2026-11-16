import type { TestConfig } from '@site/src/components/test/types';

export const testCloud: TestConfig = {
  id: 'aif-cloud',
  title: 'Fundamentos de Cloud y AWS',
  numberOfQuestions: 15,
  time: 20,
  pointsType: 'over10',
  minForPass: 6,
  onTimeUp: 'warn',
  questions: [
    {
      id: 'cloud-1',
      title: '¿Qué define mejor el Cloud Computing?',
      type: 'select',
      points: 1,
      answers: [
        'La entrega bajo demanda de recursos de TI a través de Internet con un modelo de pago por uso',
        'Un lenguaje de programación para desplegar aplicaciones distribuidas',
        'Un contrato de alquiler de hardware con una cuota fija mensual e independiente del uso',
        'La compra de servidores físicos que se instalan en el centro de datos de la empresa',
      ],
      correctAnswer: 0,
      explanation:
        'Cloud Computing es la entrega bajo demanda de computación, almacenamiento, bases de datos y redes por Internet con pago por uso, en lugar de comprar y mantener centros de datos propios.',
    },
    {
      id: 'cloud-2',
      title: '¿Cuál de las siguientes NO es una de las seis ventajas del Cloud Computing que identifica AWS?',
      type: 'select',
      points: 1,
      answers: [
        'Cambiar gastos de capital por gastos variables',
        'Comprar hardware propio para tener control físico total de la infraestructura',
        'Dejar de adivinar la capacidad necesaria',
        'Alcance global en minutos',
      ],
      correctAnswer: 1,
      explanation:
        'Las seis ventajas son: gasto variable en vez de capital, economías de escala, dejar de adivinar la capacidad, más velocidad y agilidad, dejar de mantener centros de datos y alcance global en minutos. Comprar hardware propio es lo contrario.',
    },
    {
      id: 'cloud-3',
      title: 'Una empresa quiere mantener ciertos datos sensibles en sus propias instalaciones y usar la nube pública para el resto de cargas. ¿Qué modelo de despliegue es el adecuado?',
      type: 'select',
      points: 1,
      answers: [
        'Nube pública exclusivamente',
        'Nube privada exclusivamente',
        'Nube híbrida',
        'Edge computing',
      ],
      correctAnswer: 2,
      explanation:
        'La nube híbrida combina nube pública y privada y permite compartir datos y aplicaciones entre ambas, manteniendo on-premises lo que deba quedarse allí.',
    },
    {
      id: 'cloud-4',
      title: 'En un modelo IaaS, ¿qué debe gestionar el cliente?',
      type: 'select',
      points: 1,
      answers: [
        'El sistema operativo, el middleware, las aplicaciones y los datos',
        'El hardware físico y la red del centro de datos',
        'Nada: el proveedor lo gestiona todo',
        'Únicamente los datos de las aplicaciones',
      ],
      correctAnswer: 0,
      explanation:
        'En IaaS (por ejemplo Amazon EC2) el proveedor gestiona hardware, red y virtualización; el cliente gestiona el SO, el middleware y las aplicaciones. Es el modelo con más flexibilidad y control.',
    },
    {
      id: 'cloud-5',
      title: 'Una aplicación añade y elimina servidores automáticamente según la demanda real. ¿Qué característica de la nube describe esto?',
      type: 'select',
      points: 1,
      answers: [
        'Alta disponibilidad',
        'Tolerancia a fallos',
        'Cumplimiento normativo',
        'Elasticidad',
      ],
      correctAnswer: 3,
      explanation:
        'La elasticidad es la capacidad de escalar hacia fuera y hacia dentro (scale out / scale in) de forma automática según la demanda.',
    },
    {
      id: 'cloud-6',
      title: '¿Qué es una Availability Zone (AZ)?',
      type: 'select',
      points: 1,
      answers: [
        'Un área geográfica independiente que contiene varias Regions',
        'Un punto de presencia usado por CloudFront para cachear contenido',
        'Una red privada virtual aislada dentro de una cuenta',
        'Uno o más centros de datos discretos, con energía, redes y conectividad redundantes, dentro de una Region',
      ],
      correctAnswer: 3,
      explanation:
        'Cada Region tiene varias AZs separadas físicamente entre sí pero conectadas con redes de baja latencia. Desplegar en varias AZs da alta disponibilidad.',
    },
    {
      id: 'cloud-7',
      title: '¿Para qué se utilizan principalmente las Edge Locations de AWS?',
      type: 'select',
      points: 1,
      answers: [
        'Para ejecutar las bases de datos relacionales de mayor tamaño',
        'Para almacenar copias de seguridad de larga duración',
        'Para entrenar modelos de machine learning',
        'Para entregar contenido a los usuarios finales con la menor latencia posible, sobre todo con Amazon CloudFront',
      ],
      correctAnswer: 3,
      explanation:
        'Las Edge Locations (Points of Presence) acercan el contenido al usuario final. Su servicio principal es CloudFront, la red de distribución de contenido de AWS.',
    },
    {
      id: 'cloud-8',
      title: 'Una empresa europea tiene una normativa que impide que los datos salgan de la UE. ¿Qué factor de selección de Region es el determinante?',
      type: 'select',
      points: 1,
      answers: [
        'Cantidad de Edge Locations',
        'Proximity (proximidad a los usuarios)',
        'Pricing (precio de los servicios)',
        'Compliance (cumplimiento normativo)',
      ],
      correctAnswer: 3,
      explanation:
        'Los datos nunca salen de una Region sin permiso explícito. Los cuatro factores para elegir Region son compliance, proximidad, servicios disponibles y precio; aquí manda el cumplimiento normativo.',
    },
    {
      id: 'cloud-9',
      title: '¿Qué transferencia de datos es gratuita en AWS?',
      type: 'select',
      points: 1,
      answers: [
        'Ninguna: toda transferencia de datos se factura',
        'La transferencia de datos de entrada a AWS (Data Transfer IN)',
        'La transferencia de datos de salida hacia Internet (Data Transfer OUT)',
        'La transferencia entre Regions',
      ],
      correctAnswer: 1,
      explanation:
        'AWS cobra por computación, almacenamiento y transferencia de salida; la de entrada es gratuita, lo que incentiva migrar datos a la nube.',
    },
    {
      id: 'cloud-10',
      title: 'Según el modelo de responsabilidad compartida, ¿quién es responsable de aplicar los parches del sistema operativo invitado de una instancia EC2?',
      type: 'select',
      points: 1,
      answers: [
        'Es una responsabilidad compartida a partes iguales',
        'AWS',
        'El cliente',
        'El proveedor del sistema operativo',
      ],
      correctAnswer: 2,
      explanation:
        'En EC2 (IaaS) el cliente gestiona el sistema operativo invitado, incluidos los parches. AWS se ocupa de la infraestructura física y el hipervisor.',
    },
    {
      id: 'cloud-11',
      title: '¿Cuál de las siguientes tareas es responsabilidad de AWS ("seguridad DE la nube")?',
      type: 'select',
      points: 1,
      answers: [
        'Configurar los Security Groups de las instancias',
        'La seguridad física de los centros de datos y la destrucción segura del hardware',
        'Cifrar los datos almacenados por el cliente',
        'Gestionar los usuarios y las políticas de IAM',
      ],
      correctAnswer: 1,
      explanation:
        'AWS protege la infraestructura: instalaciones, hardware, red e hipervisor. Los datos, el cifrado, IAM y los firewalls son responsabilidad del cliente.',
    },
    {
      id: 'cloud-12',
      title: '¿Cuál de estos servicios de AWS es global y no está ligado a una Region concreta?',
      type: 'select',
      points: 1,
      answers: [
        'AWS Lambda',
        'Amazon Rekognition',
        'Amazon EC2',
        'Amazon CloudFront',
      ],
      correctAnswer: 3,
      explanation:
        'IAM, Route 53, CloudFront y WAF son servicios globales. EC2, Lambda o Rekognition son regionales: los recursos viven en la Region donde se crean.',
    },
    {
      id: 'cloud-13',
      title: 'Las instancias de una subnet privada necesitan descargar actualizaciones de Internet, pero no deben ser accesibles desde fuera. ¿Qué componente se usa?',
      type: 'select',
      points: 1,
      answers: [
        'Un VPC Peering con otra VPC',
        'Un NAT Gateway desplegado en una subnet pública',
        'Un Internet Gateway asociado directamente a la subnet privada',
        'Una Network ACL con reglas Allow',
      ],
      correctAnswer: 1,
      explanation:
        'El NAT Gateway permite la salida a Internet de instancias privadas sin exponerlas a conexiones entrantes. Se despliega en una subnet pública.',
    },
    {
      id: 'cloud-14',
      title: '¿Cómo se bloquea el tráfico procedente de una dirección IP concreta en una VPC?',
      type: 'select',
      points: 1,
      answers: [
        'Con un VPC Endpoint',
        'Con una Network ACL (NACL), que admite reglas Deny',
        'Con un Security Group, añadiendo una regla Deny',
        'Con una Route Table que apunte a un Internet Gateway',
      ],
      correctAnswer: 1,
      explanation:
        'Los Security Groups solo tienen reglas Allow. Para denegar explícitamente una IP se necesita una NACL, que opera a nivel de subnet y admite Allow y Deny.',
    },
    {
      id: 'cloud-15',
      title: 'Una aplicación en una subnet privada debe acceder a Amazon S3 o a un modelo de Bedrock sin que el tráfico salga a Internet. ¿Qué se debe usar?',
      type: 'select',
      points: 1,
      answers: [
        'Un NAT Gateway',
        'Un Internet Gateway',
        'Una conexión de VPC Peering',
        'Un VPC Endpoint (AWS PrivateLink)',
      ],
      correctAnswer: 3,
      explanation:
        'Los VPC Endpoints (gateway para S3 y DynamoDB, interface mediante PrivateLink para otros servicios) conectan de forma privada con servicios de AWS sin pasar por Internet.',
    },
    {
      id: 'cloud-16',
      title: '¿Cuántas direcciones IP proporciona un bloque CIDR /24?',
      type: 'select',
      points: 1,
      answers: [
        '65.536',
        '256',
        '16',
        '1.024',
      ],
      correctAnswer: 1,
      explanation:
        'Un /24 deja 8 bits variables (2^8 = 256 direcciones). Un /16 da 65.536 y un /28, el mínimo permitido en una VPC, 16.',
    },
    {
      id: 'cloud-17',
      title: '¿Cuáles de las siguientes son ventajas del Cloud Computing según AWS? (Selecciona todas las que apliquen)',
      type: 'multiselect',
      points: 2,
      answers: [
        'Garantía de latencia cero para todos los usuarios',
        'Cambiar gastos de capital por gastos variables',
        'Comprometer el presupuesto de infraestructura a tres años',
        'Dejar de adivinar la capacidad necesaria',
        'Beneficiarse de enormes economías de escala',
      ],
      correctAnswer: [1, 3, 4],
      explanation:
        'La nube evita inversiones iniciales y permite escalar según la demanda medida, con precios más bajos por economías de escala. No exige compromisos a largo plazo ni elimina la latencia.',
    },
    {
      id: 'cloud-18',
      title: '¿Cuáles de las siguientes tareas son responsabilidad del cliente según el modelo de responsabilidad compartida?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Configurar Security Groups y firewalls',
        'Mantener el hardware físico de los servidores',
        'Garantizar la seguridad del hipervisor',
        'Cifrar sus datos en reposo y en tránsito',
        'Gestionar usuarios, roles y MFA en IAM',
      ],
      correctAnswer: [0, 3, 4],
      explanation:
        'La regla general: si se puede configurar en la consola de AWS, probablemente es responsabilidad del cliente. Hardware, hipervisor e instalaciones son de AWS.',
    },
    {
      id: 'cloud-19',
      title: '¿Qué características tienen los Security Groups?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Admiten reglas Deny explícitas',
        'Solo contienen reglas Allow',
        'Se aplican a nivel de subnet',
        'Son stateful: la respuesta al tráfico permitido se acepta automáticamente',
        'Se aplican a nivel de instancia (interfaz de red)',
      ],
      correctAnswer: [1, 3, 4],
      explanation:
        'Los Security Groups son firewalls stateful a nivel de instancia que solo permiten tráfico. Las NACL son stateless, operan a nivel de subnet y admiten Allow y Deny.',
    },
    {
      id: 'cloud-20',
      title: '¿Qué rangos de direcciones IPv4 son privados y válidos para una VPC?',
      type: 'multiselect',
      points: 2,
      answers: [
        '8.8.8.0/24',
        '10.0.0.0/8',
        '192.168.0.0/16',
        '100.0.0.0/8',
        '172.16.0.0/12',
      ],
      correctAnswer: [1, 2, 4],
      explanation:
        'Una VPC solo admite los rangos privados RFC 1918: 10.0.0.0/8, 172.16.0.0/12 y 192.168.0.0/16. Además, el CIDR no debe solaparse con otras redes con las que se quiera conectar.',
    },
    {
      id: 'cloud-21',
      title: 'Relaciona cada modelo de despliegue con su descripción',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'Nube pública', right: 'Recursos de un proveedor compartidos entre muchos clientes a través de Internet' },
        { left: 'Nube privada', right: 'Infraestructura utilizada exclusivamente por una sola organización' },
        { left: 'Nube híbrida', right: 'Combina nube pública y privada y permite compartir datos y aplicaciones entre ambas' },
      ],
      explanation:
        'La nube pública ofrece el menor coste inicial; la privada, más control; la híbrida combina ambas y es ideal para mantener datos sensibles on-premises.',
    },
    {
      id: 'cloud-22',
      title: 'Relaciona cada tipo de servicio cloud con un ejemplo de AWS',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'IaaS', right: 'Amazon EC2' },
        { left: 'PaaS', right: 'AWS Elastic Beanstalk' },
        { left: 'SaaS', right: 'Amazon WorkSpaces' },
      ],
      explanation:
        'IaaS ofrece infraestructura (EC2, VPC), PaaS la plataforma sin gestionar el SO (Elastic Beanstalk) y SaaS un producto completo gestionado por el proveedor (WorkSpaces).',
    },
    {
      id: 'cloud-23',
      title: 'Relaciona cada componente de una VPC con su función',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'Internet Gateway', right: 'Conecta la VPC con Internet' },
        { left: 'NAT Gateway', right: 'Permite que instancias de subnets privadas salgan a Internet sin ser accesibles desde fuera' },
        { left: 'Route Table', right: 'Conjunto de reglas que decide a dónde se envía el tráfico de cada subnet' },
        { left: 'VPC Peering', right: 'Conexión privada entre dos VPCs, no transitiva' },
      ],
      explanation:
        'Estos son los bloques básicos de una VPC que conviene reconocer en el examen. El peering no es transitivo y los CIDR no deben solaparse.',
    },
    {
      id: 'cloud-24',
      title: 'Clasifica cada responsabilidad según corresponda a AWS o al cliente',
      type: 'classify',
      points: 4,
      categories: ['AWS (seguridad DE la nube)', 'Cliente (seguridad EN la nube)'],
      classifyItems: [
        { text: 'Configuración de Security Groups', category: 'Cliente (seguridad EN la nube)' },
        { text: 'Destrucción segura del hardware', category: 'AWS (seguridad DE la nube)' },
        { text: 'Seguridad física de los centros de datos', category: 'AWS (seguridad DE la nube)' },
        { text: 'Cifrado de los datos del cliente', category: 'Cliente (seguridad EN la nube)' },
        { text: 'Seguridad del hipervisor', category: 'AWS (seguridad DE la nube)' },
        { text: 'Parches del sistema operativo invitado en EC2', category: 'Cliente (seguridad EN la nube)' },
      ],
      explanation:
        'AWS protege la infraestructura que ejecuta los servicios; el cliente protege lo que despliega y configura sobre ella: datos, identidades, firewalls y sistema operativo invitado.',
    },
    {
      id: 'cloud-25',
      title: 'Clasifica cada servicio como global o regional',
      type: 'classify',
      points: 4,
      categories: ['Global', 'Regional'],
      classifyItems: [
        { text: 'AWS Lambda', category: 'Regional' },
        { text: 'Amazon Route 53', category: 'Global' },
        { text: 'Amazon EC2', category: 'Regional' },
        { text: 'Amazon Rekognition', category: 'Regional' },
        { text: 'AWS IAM', category: 'Global' },
        { text: 'Amazon CloudFront', category: 'Global' },
      ],
      explanation:
        'IAM, Route 53, CloudFront y WAF son globales. La mayoría de servicios (EC2, Lambda, Rekognition...) son regionales y sus recursos no se replican automáticamente a otras Regions.',
    },
    {
      id: 'cloud-26',
      title: 'Clasifica cada característica según corresponda a un Security Group o a una Network ACL',
      type: 'classify',
      points: 4,
      categories: ['Security Group', 'Network ACL'],
      classifyItems: [
        { text: 'Admite reglas Allow y Deny', category: 'Network ACL' },
        { text: 'Solo admite reglas Allow', category: 'Security Group' },
        { text: 'Es stateless', category: 'Network ACL' },
        { text: 'Es stateful', category: 'Security Group' },
        { text: 'Opera a nivel de instancia', category: 'Security Group' },
        { text: 'Opera a nivel de subnet', category: 'Network ACL' },
      ],
      explanation:
        'Los Security Groups son stateful, a nivel de instancia y solo con Allow. Las NACL son stateless, a nivel de subnet, evalúan reglas en orden numérico y admiten Deny.',
    },
  ],
};

export const testInfra: TestConfig = {
  id: 'aif-infra',
  title: 'Almacenamiento, cómputo y bases de datos',
  numberOfQuestions: 15,
  time: 20,
  pointsType: 'over10',
  minForPass: 6,
  onTimeUp: 'warn',
  questions: [
    {
      id: 'infra-1',
      title: '¿Qué tipo de almacenamiento ofrece Amazon S3?',
      type: 'select',
      points: 1,
      answers: [
        'Base de datos relacional gestionada',
        'Almacenamiento de bloques',
        'Almacenamiento de objetos',
        'Sistema de archivos compartido NFS',
      ],
      correctAnswer: 2,
      explanation:
        'S3 es almacenamiento de objetos: cada objeto tiene una clave dentro de un bucket. EBS es de bloques y EFS es un sistema de archivos.',
    },
    {
      id: 'infra-2',
      title: '¿Qué durabilidad está diseñado para ofrecer Amazon S3?',
      type: 'select',
      points: 1,
      answers: [
        '99,9 %',
        '100 % garantizado por contrato',
        '99,99 %',
        '99,999999999 % (11 nueves)',
      ],
      correctAnswer: 3,
      explanation:
        'S3 está diseñado para una durabilidad de 11 nueves en todas sus clases de almacenamiento; lo que cambia entre clases es la disponibilidad y el coste.',
    },
    {
      id: 'infra-3',
      title: '¿Qué ocurre con los nombres de los buckets de S3?',
      type: 'select',
      points: 1,
      answers: [
        'Pueden repetirse si están en cuentas distintas',
        'Solo deben ser únicos dentro de la Region',
        'Solo deben ser únicos dentro de la cuenta',
        'Deben ser únicos globalmente en todo AWS',
      ],
      correctAnswer: 3,
      explanation:
        'El nombre de un bucket es único en todo AWS, aunque el bucket se crea en una Region concreta. Dentro del bucket, las «carpetas» son solo prefijos en la clave de los objetos.',
    },
    {
      id: 'infra-4',
      title: 'Los datos de una aplicación tienen un patrón de acceso desconocido o cambiante. ¿Qué clase de S3 conviene?',
      type: 'select',
      points: 1,
      answers: [
        'S3 Intelligent-Tiering',
        'S3 One Zone-IA',
        'S3 Standard-IA',
        'S3 Glacier Deep Archive',
      ],
      correctAnswer: 0,
      explanation:
        'Intelligent-Tiering mueve los objetos automáticamente entre niveles según su patrón de acceso, sin penalización de recuperación y con acceso en milisegundos.',
    },
    {
      id: 'infra-5',
      title: 'Una empresa debe archivar datos por requisitos de compliance durante 7-10 años con el menor coste posible. ¿Qué clase de S3 elige?',
      type: 'select',
      points: 1,
      answers: [
        'S3 Intelligent-Tiering',
        'S3 Express One Zone',
        'S3 Glacier Deep Archive',
        'S3 Standard',
      ],
      correctAnswer: 2,
      explanation:
        'Deep Archive es la clase más barata para archivo a largo plazo; la recuperación tarda entre 12 y 48 horas y tiene una duración mínima de 180 días.',
    },
    {
      id: 'infra-6',
      title: '¿Qué requisito es imprescindible para activar la replicación entre Regions (CRR) en S3?',
      type: 'select',
      points: 1,
      answers: [
        'Que el bucket de origen use S3 One Zone-IA',
        'Desactivar el cifrado SSE-S3',
        'Que ambos buckets pertenezcan a la misma cuenta',
        'Tener el versionado activado en los buckets de origen y de destino',
      ],
      correctAnswer: 3,
      explanation:
        'CRR y SRR requieren versionado en origen y destino, y la copia es asíncrona. CRR se usa para compliance, menor latencia y recuperación ante desastres.',
    },
    {
      id: 'infra-7',
      title: '¿Qué hace S3 Block Public Access?',
      type: 'select',
      points: 1,
      answers: [
        'Elimina los objetos antiguos mediante reglas de ciclo de vida',
        'Cifra automáticamente todos los objetos con claves del cliente',
        'Impide exponer datos públicamente aunque una política de bucket lo permita, y está activado por defecto',
        'Replica los objetos a otra Region',
      ],
      correctAnswer: 2,
      explanation:
        'Block Public Access es una salvaguarda a nivel de cuenta o de bucket. Si un sitio estático devuelve 403, suele ser por esta protección o por una bucket policy sin lecturas públicas.',
    },
    {
      id: 'infra-8',
      title: '¿Qué es Amazon EBS?',
      type: 'select',
      points: 1,
      answers: [
        'Un disco de red de almacenamiento de bloques ligado a una Availability Zone',
        'Un servicio de almacenamiento de objetos',
        'Un sistema de archivos compartido por miles de instancias',
        'Una base de datos en memoria',
      ],
      correctAnswer: 0,
      explanation:
        'EBS es un volumen de bloques que se adjunta a instancias EC2 de la misma AZ. Por defecto solo se monta en una instancia a la vez (io1/io2 admiten Multi-Attach).',
    },
    {
      id: 'infra-9',
      title: '¿Cómo se mueve un volumen EBS de una Availability Zone a otra?',
      type: 'select',
      points: 1,
      answers: [
        'Creando un snapshot y restaurando un volumen en la AZ de destino',
        'Cambiando el tipo de volumen a gp3',
        'Es imposible moverlo',
        'Adjuntándolo directamente a una instancia de la otra AZ',
      ],
      correctAnswer: 0,
      explanation:
        'Los volúmenes EBS están vinculados a una AZ; para cambiarlos de zona hay que pasar por un snapshot.',
    },
    {
      id: 'infra-10',
      title: '¿Qué servicio ofrece un sistema de archivos NFS elástico al que pueden acceder a la vez instancias de varias AZs?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon EBS',
        'Amazon EFS',
        'Amazon S3 Glacier',
        'Amazon DynamoDB',
      ],
      correctAnswer: 1,
      explanation:
        'EFS es un sistema de archivos gestionado que crece y se reduce automáticamente, soporta NFS y puede ser Multi-AZ. Se factura por el uso real.',
    },
    {
      id: 'infra-11',
      title: '¿Qué variante de Amazon FSx está pensada para HPC y machine learning y se integra con Amazon S3?',
      type: 'select',
      points: 1,
      answers: [
        'FSx for Windows File Server',
        'FSx for OpenZFS',
        'FSx for NetApp ONTAP',
        'FSx for Lustre',
      ],
      correctAnswer: 3,
      explanation:
        'Lustre ofrece throughput muy alto y puede importar y exportar datos desde y hacia S3, lo que encaja en pipelines de ML con grandes datasets.',
    },
    {
      id: 'infra-12',
      title: '¿Qué tipo de instancia EC2 es el más adecuado para entrenar modelos de machine learning?',
      type: 'select',
      points: 1,
      answers: [
        'General Purpose (familia t)',
        'Memory Optimized (familia r)',
        'Accelerated Computing (familias p, g o trn)',
        'Storage Optimized (familia i)',
      ],
      correctAnswer: 2,
      explanation:
        'Accelerated Computing agrupa GPUs y chips propios de AWS (Trainium, Inferentia) para entrenamiento e inferencia de modelos.',
    },
    {
      id: 'infra-13',
      title: '¿Qué descuento máximo ofrecen las Spot Instances respecto a On-Demand y qué riesgo tienen?',
      type: 'select',
      points: 1,
      answers: [
        'Hasta un 72 %, con compromiso de 1 o 3 años',
        'Hasta un 90 % de descuento, pero AWS puede interrumpirlas con un aviso de 2 minutos',
        'Un 50 % fijo con capacidad garantizada',
        'Hasta un 90 %, sin ningún riesgo de interrupción',
      ],
      correctAnswer: 1,
      explanation:
        'Spot es ideal para cargas tolerantes a fallos (batch, análisis, renderizado). Reserved Instances y Savings Plans dan hasta un 72 % con compromiso.',
    },
    {
      id: 'infra-14',
      title: '¿Cuál es el tiempo máximo de ejecución de una función de AWS Lambda?',
      type: 'select',
      points: 1,
      answers: [
        '60 segundos',
        '15 minutos',
        '1 hora',
        '24 horas',
      ],
      correctAnswer: 1,
      explanation:
        'Cada ejecución de Lambda dura como máximo 15 minutos. Para trabajos más largos se usan ECS/Fargate o AWS Batch.',
    },
    {
      id: 'infra-15',
      title: '¿Qué es AWS Fargate?',
      type: 'select',
      points: 1,
      answers: [
        'Un motor de cómputo serverless para contenedores que funciona con ECS y EKS',
        'Un servicio gestionado de Kubernetes',
        'Un servicio de procesamiento por lotes',
        'Un sistema de archivos para contenedores',
      ],
      correctAnswer: 0,
      explanation:
        'Con Fargate no se aprovisionan ni gestionan servidores: AWS ejecuta los contenedores. EKS es el servicio de Kubernetes y AWS Batch el de procesamiento por lotes.',
    },
    {
      id: 'infra-16',
      title: 'Se necesita una base de datos NoSQL clave-valor serverless con latencia de milisegundos a cualquier escala. ¿Qué servicio es?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon RDS',
        'Amazon Neptune',
        'Amazon Redshift',
        'Amazon DynamoDB',
      ],
      correctAnswer: 3,
      explanation:
        'DynamoDB es clave-valor y serverless, sin ventanas de mantenimiento. RDS es relacional, Redshift un data warehouse y Neptune una base de datos de grafos.',
    },
    {
      id: 'infra-17',
      title: '¿Qué servicio es la opción adecuada para datos muy conectados, como detección de fraude, redes sociales o GraphRAG?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon Keyspaces',
        'Amazon Timestream',
        'Amazon Neptune',
        'Amazon DocumentDB',
      ],
      correctAnswer: 2,
      explanation:
        'Neptune es una base de datos de grafos; Neptune ML aplica Graph Neural Networks sobre SageMaker para predicciones sobre datos de grafo.',
    },
    {
      id: 'infra-18',
      title: '¿Qué clases de S3 ofrecen acceso poco frecuente con recuperación en milisegundos?',
      type: 'multiselect',
      points: 2,
      answers: [
        'S3 Glacier Flexible Retrieval',
        'S3 One Zone-IA',
        'S3 Standard-IA',
        'S3 Glacier Instant Retrieval',
        'S3 Glacier Deep Archive',
      ],
      correctAnswer: [1, 2, 3],
      explanation:
        'Standard-IA, One Zone-IA y Glacier Instant Retrieval recuperan en milisegundos. Flexible Retrieval tarda de minutos a horas y Deep Archive de 12 a 48 horas.',
    },
    {
      id: 'infra-19',
      title: '¿Qué modelos de precios de EC2 exigen un compromiso de 1 o 3 años?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Savings Plans',
        'On-Demand',
        'Reserved Instances',
        'Spot Instances',
      ],
      correctAnswer: [0, 2],
      explanation:
        'Reserved Instances y Savings Plans dan hasta un 72 % de descuento a cambio de comprometerse. On-Demand y Spot no exigen compromiso.',
    },
    {
      id: 'infra-20',
      title: '¿Qué motores de bases de datos relacionales ofrece Amazon RDS?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Amazon Aurora compatible con MySQL',
        'RDS for PostgreSQL',
        'Amazon DynamoDB',
        'Amazon Redshift',
        'RDS for Oracle',
      ],
      correctAnswer: [0, 1, 4],
      explanation:
        'RDS ofrece Aurora (MySQL y PostgreSQL), PostgreSQL, MySQL, MariaDB, SQL Server, Oracle y Db2. DynamoDB es NoSQL y Redshift un data warehouse.',
    },
    {
      id: 'infra-21',
      title: '¿Qué características de Amazon EFS son correctas?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Puede ser Multi-AZ (Regional)',
        'Solo se puede montar en una instancia a la vez',
        'Se factura por la capacidad aprovisionada',
        'Soporta el protocolo NFS',
        'Crece y se reduce automáticamente al añadir o eliminar archivos',
      ],
      correctAnswer: [0, 3, 4],
      explanation:
        'EFS se factura por el uso real y puede compartirse entre miles de instancias. La facturación por capacidad aprovisionada es propia de EBS.',
    },
    {
      id: 'infra-22',
      title: 'Relaciona cada servicio de almacenamiento con su tipo',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'Amazon EBS', right: 'Almacenamiento de bloques ligado a una AZ' },
        { left: 'Amazon EFS', right: 'Sistema de archivos NFS elástico y compartido' },
        { left: 'Amazon S3', right: 'Almacenamiento de objetos accesible vía API/HTTP' },
        { left: 'FSx for Windows File Server', right: 'Sistema de archivos SMB para aplicaciones Windows' },
      ],
      explanation:
        'Distinguir bloques (EBS), archivos (EFS, FSx) y objetos (S3) es la base de las preguntas de almacenamiento del examen.',
    },
    {
      id: 'infra-23',
      title: 'Relaciona cada base de datos de AWS con su caso de uso',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'Amazon DynamoDB', right: 'Clave-valor NoSQL serverless' },
        { left: 'Amazon Neptune', right: 'Grafos: fraude, recomendaciones y GraphRAG' },
        { left: 'Amazon DocumentDB', right: 'Documental, compatible con MongoDB' },
        { left: 'Amazon Timestream', right: 'Series temporales para IoT y telemetría' },
      ],
      explanation:
        'Cada motor está optimizado para un tipo de datos y un patrón de acceso; elegir el correcto es una decisión arquitectónica básica.',
    },
    {
      id: 'infra-24',
      title: 'Relaciona cada servicio de cómputo con su descripción',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'Amazon EC2', right: 'Máquinas virtuales redimensionables (IaaS)' },
        { left: 'AWS Lambda', right: 'Funciones serverless disparadas por eventos' },
        { left: 'Amazon EKS', right: 'Kubernetes totalmente gestionado' },
        { left: 'AWS Batch', right: 'Procesamiento por lotes totalmente gestionado' },
      ],
      explanation:
        'EC2 da control total del servidor, Lambda ejecuta código sin servidores, EKS orquesta contenedores con Kubernetes y Batch planifica trabajos por lotes.',
    },
    {
      id: 'infra-25',
      title: 'Clasifica cada modelo de precios de EC2 según exija compromiso o no',
      type: 'classify',
      points: 4,
      categories: ['Con compromiso de 1 o 3 años', 'Sin compromiso'],
      classifyItems: [
        { text: 'Reserved Instances', category: 'Con compromiso de 1 o 3 años' },
        { text: 'Spot Instances', category: 'Sin compromiso' },
        { text: 'On-Demand', category: 'Sin compromiso' },
        { text: 'Savings Plans', category: 'Con compromiso de 1 o 3 años' },
        { text: 'Capacity Reservations', category: 'Sin compromiso' },
      ],
      explanation:
        'Los descuentos más altos por compromiso (hasta 72 %) llegan con Reserved Instances y Savings Plans; On-Demand y Spot no tienen compromiso, aunque Spot puede interrumpirse.',
    },
    {
      id: 'infra-26',
      title: 'Clasifica cada servicio según el tipo de base de datos',
      type: 'classify',
      points: 4,
      categories: ['Relacional', 'NoSQL', 'En memoria'],
      classifyItems: [
        { text: 'Amazon DocumentDB', category: 'NoSQL' },
        { text: 'Amazon ElastiCache', category: 'En memoria' },
        { text: 'Amazon Aurora', category: 'Relacional' },
        { text: 'Amazon RDS for MySQL', category: 'Relacional' },
        { text: 'Amazon DynamoDB', category: 'NoSQL' },
        { text: 'Amazon MemoryDB', category: 'En memoria' },
      ],
      explanation:
        'Aurora y RDS son relacionales; DynamoDB y DocumentDB, NoSQL; ElastiCache y MemoryDB mantienen los datos en memoria para latencias ultrabajas, caching y semantic caching en GenAI.',
    },
    {
      id: 'infra-27',
      title: 'Clasifica cada tipo de volumen EBS según pueda usarse o no como volumen de arranque',
      type: 'classify',
      points: 4,
      categories: ['Puede ser volumen de arranque (SSD)', 'No puede ser volumen de arranque (HDD)'],
      classifyItems: [
        { text: 'st1', category: 'No puede ser volumen de arranque (HDD)' },
        { text: 'sc1', category: 'No puede ser volumen de arranque (HDD)' },
        { text: 'io2 Block Express', category: 'Puede ser volumen de arranque (SSD)' },
        { text: 'io1', category: 'Puede ser volumen de arranque (SSD)' },
        { text: 'gp2', category: 'Puede ser volumen de arranque (SSD)' },
        { text: 'gp3', category: 'Puede ser volumen de arranque (SSD)' },
      ],
      explanation:
        'Solo los volúmenes SSD (gp2, gp3, io1, io2) sirven como disco de arranque. Los HDD st1 (throughput optimizado) y sc1 (cold) no.',
    },
  ],
};

export const testGestion: TestConfig = {
  id: 'aif-gestion',
  title: 'Gestión, IAM y analítica',
  numberOfQuestions: 15,
  time: 20,
  pointsType: 'over10',
  minForPass: 6,
  onTimeUp: 'warn',
  questions: [
    {
      id: 'gestion-1',
      title: '¿Qué servicio registra quién hizo cada llamada a la API de AWS, cuándo y desde dónde?',
      type: 'select',
      points: 1,
      answers: [
        'AWS Trusted Advisor',
        'AWS Config',
        'Amazon CloudWatch',
        'AWS CloudTrail',
      ],
      correctAnswer: 3,
      explanation:
        'CloudTrail audita la actividad de la API de la cuenta. CloudWatch monitoriza rendimiento (métricas, logs, alarmas) y Config evalúa la configuración de los recursos.',
    },
    {
      id: 'gestion-2',
      title: '¿Qué servicio permite evaluar si los recursos cumplen la configuración deseada y ver cómo han cambiado?',
      type: 'select',
      points: 1,
      answers: [
        'AWS CloudTrail',
        'Amazon CloudWatch',
        'AWS Budgets',
        'AWS Config',
      ],
      correctAnswer: 3,
      explanation:
        'Config registra de forma continua las configuraciones de los recursos y evalúa su conformidad con reglas, algo clave para el cumplimiento normativo.',
    },
    {
      id: 'gestion-3',
      title: '¿Qué servicio se utiliza para crear alarmas cuando el uso de CPU de una instancia supera un umbral?',
      type: 'select',
      points: 1,
      answers: [
        'AWS Organizations',
        'AWS CloudTrail',
        'Amazon CloudWatch',
        'AWS Config',
      ],
      correctAnswer: 2,
      explanation:
        'CloudWatch recopila métricas y logs y permite alarmas que reaccionan automáticamente a cambios de rendimiento.',
    },
    {
      id: 'gestion-4',
      title: '¿Qué afirmación sobre las Service Control Policies (SCP) es correcta?',
      type: 'select',
      points: 1,
      answers: [
        'Solo pueden aplicarse a nivel de usuario IAM',
        'Se aplican también a la cuenta de gestión de la organización',
        'No conceden permisos: fijan el límite máximo de lo que pueden hacer las cuentas miembro',
        'Sustituyen a las políticas IAM de los usuarios',
      ],
      correctAnswer: 2,
      explanation:
        'Las SCP restringen a usuarios y roles de las cuentas miembro (incluido su root), pero nunca a la Management Account. Para que una acción esté permitida debe permitirla tanto la SCP como la política IAM.',
    },
    {
      id: 'gestion-5',
      title: '¿Qué servicio configura un entorno multi-cuenta (landing zone) siguiendo buenas prácticas y aplica guardrails?',
      type: 'select',
      points: 1,
      answers: [
        'AWS CloudFormation',
        'AWS Control Tower',
        'AWS Service Catalog',
        'AWS Systems Manager',
      ],
      correctAnswer: 1,
      explanation:
        'Control Tower orquesta Organizations, Service Catalog e IAM Identity Center y establece guardrails preventivos y detectivos en todas las cuentas.',
    },
    {
      id: 'gestion-6',
      title: '¿Cuál de los siguientes NO es un pilar del AWS Well-Architected Framework?',
      type: 'select',
      points: 1,
      answers: [
        'Reliability',
        'Cost Optimization',
        'Scalability',
        'Sustainability',
      ],
      correctAnswer: 2,
      explanation:
        'Los seis pilares son Operational Excellence, Security, Reliability, Performance Efficiency, Cost Optimization y Sustainability.',
    },
    {
      id: 'gestion-7',
      title: '¿Qué servicio avisa por correo o SNS cuando los costes reales o previstos superan un umbral definido?',
      type: 'select',
      points: 1,
      answers: [
        'AWS Cost Explorer',
        'AWS Cost and Usage Reports',
        'AWS Budgets',
        'AWS Trusted Advisor',
      ],
      correctAnswer: 2,
      explanation:
        'Budgets permite presupuestos de costes, uso, reservas o Savings Plans con alertas. Cost Explorer visualiza costes y CUR ofrece el detalle más completo.',
    },
    {
      id: 'gestion-8',
      title: '¿Qué servicio analiza la cuenta y da recomendaciones sobre coste, rendimiento, seguridad, tolerancia a fallos y límites de servicio?',
      type: 'select',
      points: 1,
      answers: [
        'AWS Security Hub',
        'AWS Config',
        'AWS Trusted Advisor',
        'Amazon GuardDuty',
      ],
      correctAnswer: 2,
      explanation:
        'Trusted Advisor ofrece recomendaciones en cinco categorías; los planes Business y Enterprise desbloquean todas las comprobaciones.',
    },
    {
      id: 'gestion-9',
      title: '¿Qué debe hacerse con el usuario root de una cuenta de AWS?',
      type: 'select',
      points: 1,
      answers: [
        'Usarlo para ejecutar las aplicaciones',
        'Protegerlo con MFA y no usarlo para las tareas diarias',
        'Compartirlo entre los administradores del equipo',
        'Eliminarlo tras crear la cuenta',
      ],
      correctAnswer: 1,
      explanation:
        'El root tiene acceso completo. Las buenas prácticas son proteger con MFA, no compartirlo y crear usuarios o roles IAM para el trabajo diario.',
    },
    {
      id: 'gestion-10',
      title: 'En IAM, una política tiene un Allow explícito y otra un Deny explícito sobre la misma acción. ¿Cuál es el resultado?',
      type: 'select',
      points: 1,
      answers: [
        'La acción queda denegada, porque un Deny explícito siempre gana',
        'La acción queda permitida, porque el Allow prevalece',
        'Se aplica la política más reciente',
        'Se pide confirmación al administrador',
      ],
      correctAnswer: 0,
      explanation:
        'Por defecto todo está denegado (implicit deny); un Allow explícito concede el permiso, pero un Deny explícito siempre prevalece sobre cualquier Allow.',
    },
    {
      id: 'gestion-11',
      title: 'Una instancia EC2 necesita leer objetos de S3 sin almacenar claves de acceso en el servidor. ¿Qué se debe usar?',
      type: 'select',
      points: 1,
      answers: [
        'Las credenciales del usuario root',
        'Un rol de IAM asociado a la instancia',
        'Un usuario IAM con access keys guardadas en el código',
        'Un grupo de IAM con la instancia como miembro',
      ],
      correctAnswer: 1,
      explanation:
        'Los roles proporcionan credenciales temporales vía STS, ideales para servicios de AWS (EC2, Lambda, SageMaker, Bedrock) y acceso entre cuentas.',
    },
    {
      id: 'gestion-12',
      title: '¿Qué servicio ofrece inicio de sesión único (SSO) a varias cuentas de AWS y aplicaciones, integrándose con Active Directory?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon Cognito Sync',
        'AWS Secrets Manager',
        'AWS IAM Identity Center',
        'AWS Resource Access Manager',
      ],
      correctAnswer: 2,
      explanation:
        'IAM Identity Center (antes AWS SSO) gestiona de forma centralizada el acceso a múltiples cuentas y aplicaciones con proveedores de identidad externos.',
    },
    {
      id: 'gestion-13',
      title: '¿Qué servicio detecta amenazas analizando continuamente la actividad con machine learning y detección de anomalías?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon Inspector',
        'AWS Shield',
        'AWS WAF',
        'Amazon GuardDuty',
      ],
      correctAnswer: 3,
      explanation:
        'GuardDuty usa ML, anomalías e inteligencia de amenazas. Inspector busca vulnerabilidades, WAF filtra tráfico web y Shield protege contra DDoS.',
    },
    {
      id: 'gestion-14',
      title: '¿Qué servicio protege una aplicación web de ataques como SQL injection y cross-site scripting (XSS)?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon GuardDuty',
        'AWS Certificate Manager',
        'AWS Shield',
        'AWS WAF',
      ],
      correctAnswer: 3,
      explanation:
        'WAF permite crear reglas que bloquean patrones de ataque comunes. Shield cubre ataques DDoS (Shield Standard es gratuito y automático).',
    },
    {
      id: 'gestion-15',
      title: '¿Qué servicio permite lanzar consultas SQL directamente sobre datos almacenados en Amazon S3, sin gestionar infraestructura?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon Athena',
        'Amazon OpenSearch Service',
        'Amazon Redshift',
        'Amazon QuickSight',
      ],
      correctAnswer: 0,
      explanation:
        'Athena es serverless, usa SQL estándar y se paga por consulta. Redshift es un data warehouse y QuickSight una herramienta de BI.',
    },
    {
      id: 'gestion-16',
      title: '¿Qué servicio de AWS carga datos en streaming hacia S3, Redshift u OpenSearch sin que haya que escribir código de procesamiento?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon Data Firehose',
        'Amazon MSK',
        'Amazon Kinesis Data Streams',
        'AWS Glue',
      ],
      correctAnswer: 0,
      explanation:
        'Firehose es totalmente gestionado y gestiona escalado, buffering y compresión. Kinesis Data Streams requiere código propio de procesamiento.',
    },
    {
      id: 'gestion-17',
      title: '¿Qué elementos son obligatorios en una declaración (statement) de una política IAM basada en identidad?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Effect',
        'Condition',
        'Sid',
        'Resource',
        'Action',
      ],
      correctAnswer: [0, 3, 4],
      explanation:
        'Effect, Action y Resource son obligatorios (más Version y Statement a nivel de documento). Sid y Condition son opcionales; Principal solo aparece en políticas de recurso.',
    },
    {
      id: 'gestion-18',
      title: '¿Cuáles son buenas prácticas de IAM?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Activar MFA, especialmente en el usuario root',
        'Usar el usuario root para las tareas diarias',
        'Usar roles en lugar de compartir credenciales',
        'Aplicar el principio de mínimo privilegio',
        'Compartir las access keys entre los miembros del equipo',
      ],
      correctAnswer: [0, 2, 3],
      explanation:
        'Otras prácticas: rotar credenciales, asignar permisos mediante grupos y auditar con IAM Access Analyzer o el Credentials Report.',
    },
    {
      id: 'gestion-19',
      title: '¿Cuáles de los siguientes servicios pertenecen a la analítica de AWS?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Amazon Athena',
        'Amazon Redshift',
        'Amazon QuickSight',
        'Amazon GuardDuty',
        'AWS CloudTrail',
      ],
      correctAnswer: [0, 1, 2],
      explanation:
        'Athena (consultas SQL), Redshift (data warehouse) y QuickSight (BI) son de analítica. GuardDuty y CloudTrail son servicios de seguridad y auditoría.',
    },
    {
      id: 'gestion-20',
      title: '¿Qué afirmaciones sobre Kinesis Data Streams y Data Firehose son correctas?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Con Data Streams el usuario escribe el código de procesamiento',
        'Firehose ofrece control total sobre los shards',
        'Data Streams carga datos automáticamente sin ningún código',
        'Firehose puede entregar datos a destinos como S3, Redshift u OpenSearch',
        'Firehose es totalmente gestionado y no requiere código',
      ],
      correctAnswer: [0, 3, 4],
      explanation:
        'Data Streams da control total (shards, retención de 24 horas hasta 365 días) y latencia de unos 200 ms; Firehose automatiza la carga con una latencia mínima de aproximadamente 60 segundos.',
    },
    {
      id: 'gestion-21',
      title: 'Relaciona cada servicio con la pregunta que responde',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'Amazon CloudWatch', right: '¿Cómo se están comportando mis recursos?' },
        { left: 'AWS CloudTrail', right: '¿Quién hizo qué llamada a la API, cuándo y desde dónde?' },
        { left: 'AWS Config', right: '¿Mis recursos cumplen la configuración deseada?' },
        { left: 'AWS Trusted Advisor', right: '¿Qué puedo mejorar en coste, seguridad, rendimiento y límites?' },
      ],
      explanation:
        'Es una de las comparativas más preguntadas: monitorización (CloudWatch), auditoría de API (CloudTrail), conformidad de configuración (Config) y recomendaciones (Trusted Advisor).',
    },
    {
      id: 'gestion-22',
      title: 'Relaciona cada servicio de seguridad con su función',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'Amazon GuardDuty', right: 'Detección de amenazas con ML y detección de anomalías' },
        { left: 'Amazon Inspector', right: 'Escaneo de vulnerabilidades en EC2, contenedores y Lambda' },
        { left: 'AWS WAF', right: 'Protege las aplicaciones web de exploits como SQL injection y XSS' },
        { left: 'AWS Shield', right: 'Protección frente a ataques DDoS' },
      ],
      explanation:
        'Cada servicio cubre una capa distinta: detección de amenazas, vulnerabilidades, tráfico web malicioso y denegación de servicio distribuida.',
    },
    {
      id: 'gestion-23',
      title: 'Relaciona cada servicio de analítica con su función',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'Amazon Athena', right: 'Consultas SQL sobre datos en S3 sin infraestructura' },
        { left: 'Amazon Redshift', right: 'Data warehouse columnar para análisis OLAP' },
        { left: 'Amazon QuickSight', right: 'Business Intelligence serverless con dashboards' },
        { left: 'AWS Glue', right: 'Integración de datos ETL con catálogo de datos' },
      ],
      explanation:
        'Athena consulta, Redshift almacena para análisis, QuickSight visualiza y Glue prepara y cataloga los datos.',
    },
    {
      id: 'gestion-24',
      title: 'Clasifica cada necesidad según el servicio que la resuelve',
      type: 'classify',
      points: 4,
      categories: ['Amazon CloudWatch', 'AWS CloudTrail', 'AWS Config'],
      classifyItems: [
        { text: 'Auditar las llamadas a la API de la cuenta', category: 'AWS CloudTrail' },
        { text: 'Centralizar logs de aplicación y métricas', category: 'Amazon CloudWatch' },
        { text: 'Ver cómo ha cambiado la configuración de un Security Group', category: 'AWS Config' },
        { text: 'Comprobar si todos los volúmenes EBS están cifrados', category: 'AWS Config' },
        { text: 'Saber quién eliminó un bucket ayer a las 10:00', category: 'AWS CloudTrail' },
        { text: 'Lanzar una alarma cuando la CPU supera el 80 %', category: 'Amazon CloudWatch' },
      ],
      explanation:
        'CloudWatch mide el rendimiento, CloudTrail audita la actividad de la API y Config evalúa y registra el estado de configuración de los recursos.',
    },
    {
      id: 'gestion-25',
      title: 'Clasifica cada identidad de IAM según el tipo de credenciales que utiliza',
      type: 'classify',
      points: 4,
      categories: ['Credenciales permanentes', 'Credenciales temporales (STS)', 'Sin credenciales propias'],
      classifyItems: [
        { text: 'Grupo IAM', category: 'Sin credenciales propias' },
        { text: 'Usuario IAM', category: 'Credenciales permanentes' },
        { text: 'Rol IAM', category: 'Credenciales temporales (STS)' },
        { text: 'Rol de ejecución de una función Lambda', category: 'Credenciales temporales (STS)' },
        { text: 'Usuario root', category: 'Credenciales permanentes' },
      ],
      explanation:
        'Los usuarios tienen contraseña o access keys permanentes; los roles entregan credenciales temporales; un grupo solo agrupa usuarios y permisos y no tiene credenciales.',
    },
    {
      id: 'gestion-26',
      title: 'Clasifica cada necesidad de gestión de costes según el servicio adecuado',
      type: 'classify',
      points: 4,
      categories: ['AWS Budgets', 'AWS Cost Explorer', 'AWS Cost and Usage Reports'],
      classifyItems: [
        { text: 'Identificar tendencias y anomalías de costes', category: 'AWS Cost Explorer' },
        { text: 'Enviar una notificación SNS al alcanzar el 80 % del gasto', category: 'AWS Budgets' },
        { text: 'Visualizar gráficamente los costes por servicio a lo largo del tiempo', category: 'AWS Cost Explorer' },
        { text: 'Analizar el detalle de cada recurso y servicio utilizado', category: 'AWS Cost and Usage Reports' },
        { text: 'Recibir una alerta cuando se prevé superar el presupuesto', category: 'AWS Budgets' },
        { text: 'Obtener el conjunto más completo de datos de costes y uso por recurso', category: 'AWS Cost and Usage Reports' },
      ],
      explanation:
        'Budgets avisa, Cost Explorer visualiza y analiza tendencias, y los Cost and Usage Reports ofrecen el máximo nivel de detalle para análisis granular.',
    },
  ],
};

export const testServiciosIA: TestConfig = {
  id: 'aif-servicios-ia',
  title: 'Servicios de IA y ML de AWS',
  numberOfQuestions: 15,
  time: 20,
  pointsType: 'over10',
  minForPass: 6,
  onTimeUp: 'warn',
  questions: [
    {
      id: 'servicios-1',
      title: 'Una plataforma de redes sociales quiere detectar automáticamente imágenes inapropiadas antes de publicarlas. ¿Qué servicio usa?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon Comprehend',
        'Amazon Textract',
        'Amazon Polly',
        'Amazon Rekognition (content moderation)',
      ],
      correctAnswer: 3,
      explanation:
        'Rekognition analiza imágenes y vídeo y detecta contenido inapropiado. Textract extrae texto de documentos y Comprehend analiza texto.',
    },
    {
      id: 'servicios-2',
      title: 'Una aseguradora quiere extraer automáticamente datos de formularios de reclamación escaneados. ¿Qué servicio es el adecuado?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon Lex',
        'Amazon Textract',
        'Amazon Rekognition',
        'Amazon Translate',
      ],
      correctAnswer: 1,
      explanation:
        'Textract extrae texto, escritura a mano, tablas y pares clave-valor de documentos escaneados. Si el escenario habla de facturas, recibos o formularios, la respuesta es Textract.',
    },
    {
      id: 'servicios-3',
      title: 'Una empresa quiere analizar el sentimiento de miles de reseñas de producto escritas por clientes. ¿Qué servicio usa?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon Transcribe',
        'Amazon Comprehend',
        'Amazon Personalize',
        'Amazon Forecast',
      ],
      correctAnswer: 1,
      explanation:
        'Comprehend es el servicio de NLP de AWS: sentimiento, entidades, idioma, frases clave, clasificación de documentos y modelado de tópicos.',
    },
    {
      id: 'servicios-4',
      title: '¿Cuál es el modelo de precios de Amazon Polly?',
      type: 'select',
      points: 1,
      answers: [
        'Una cuota mensual fija',
        'Por hora de instancia en ejecución',
        'Por número de caracteres convertidos a voz',
        'Por minutos de audio generado',
      ],
      correctAnswer: 2,
      explanation:
        'Polly convierte texto a voz (voces estándar y neurales, con soporte SSML) y se factura por carácter procesado.',
    },
    {
      id: 'servicios-5',
      title: '¿Dónde deben almacenarse los archivos de audio para lanzar un trabajo por lotes (batch job) de Amazon Transcribe?',
      type: 'select',
      points: 1,
      answers: [
        'En Amazon DynamoDB',
        'En Amazon S3',
        'En Amazon ElastiCache',
        'En Amazon EBS',
      ],
      correctAnswer: 1,
      explanation:
        'Transcribe lee el audio desde S3 en los batch jobs y también admite streaming en tiempo real para llamadas, reuniones o eventos en vivo.',
    },
    {
      id: 'servicios-6',
      title: 'Una empresa quiere traducir en tiempo real las comunicaciones de soporte al cliente a varios idiomas. ¿Qué servicio usa?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon Translate',
        'Amazon Polly',
        'Amazon Comprehend',
        'Amazon Kendra',
      ],
      correctAnswer: 0,
      explanation:
        'Translate es un servicio de traducción automática neuronal. Puede combinarse con Comprehend para detectar primero el idioma o con Polly para audio multilingüe.',
    },
    {
      id: 'servicios-7',
      title: '¿Qué servicio permite construir chatbots con voz y texto definiendo intents y slots?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon Personalize',
        'Amazon Lex',
        'Amazon Textract',
        'Amazon Kendra',
      ],
      correctAnswer: 1,
      explanation:
        'Lex usa la misma tecnología que Alexa; admite conversaciones multiturno, se integra con Lambda para la lógica de negocio y con Amazon Connect para centros de contacto.',
    },
    {
      id: 'servicios-8',
      title: 'Un retailer quiere predecir la demanda de inventario a partir de datos históricos de series temporales. ¿Qué servicio encaja?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon Rekognition',
        'Amazon Personalize',
        'Amazon Forecast',
        'Amazon Fraud Detector',
      ],
      correctAnswer: 2,
      explanation:
        'Forecast usa ML para generar previsiones sobre series temporales almacenadas en S3. AWS ha retirado el servicio a nuevos clientes, pero puede aparecer en el examen.',
    },
    {
      id: 'servicios-9',
      title: '¿Qué servicio genera recomendaciones personalizadas de productos o contenido en tiempo real para cada usuario?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon Kendra',
        'Amazon Comprehend',
        'Amazon Forecast',
        'Amazon Personalize',
      ],
      correctAnswer: 3,
      explanation:
        'Personalize usa la misma tecnología de recomendación que Amazon.com para comercio electrónico, streaming, noticias o campañas de marketing.',
    },
    {
      id: 'servicios-10',
      title: 'Los empleados necesitan encontrar respuestas precisas en la documentación corporativa dispersa en S3 y SharePoint. ¿Qué servicio usa?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon Lex',
        'Amazon Translate',
        'Amazon Kendra',
        'Amazon Athena',
      ],
      correctAnswer: 2,
      explanation:
        'Kendra es búsqueda empresarial inteligente: entiende el contexto y la intención de las consultas y devuelve la respuesta, no solo una lista de documentos.',
    },
    {
      id: 'servicios-11',
      title: '¿Qué servicio de AWS asiste a los desarrolladores escribiendo, depurando y optimizando código desde el IDE o la consola?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon Q Business',
        'Amazon Q Developer',
        'Amazon Kendra',
        'Amazon Lex',
      ],
      correctAnswer: 1,
      explanation:
        'Q Developer es el asistente para desarrollo de software; Q Business es el asistente para empleados con conocimiento y datos de la empresa.',
    },
    {
      id: 'servicios-12',
      title: '¿Se puede elegir qué Foundation Model utiliza Amazon Q Business?',
      type: 'select',
      points: 1,
      answers: [
        'No: Q gestiona por ti el modelo subyacente de Bedrock; para elegir modelo se usa Bedrock directamente',
        'Sí, entrenando un modelo propio en SageMaker',
        'Sí, desde la consola eligiendo entre todos los modelos de Bedrock',
        'Sí, pero solo entre modelos de Anthropic',
      ],
      correctAnswer: 0,
      explanation:
        'Amazon Q Business es un servicio totalmente gestionado sobre Bedrock: el cliente configura datos, usuarios y guardrails, no el modelo.',
    },
    {
      id: 'servicios-13',
      title: '¿Qué servicio facilita incorporar revisión humana de las predicciones de ML con baja confianza?',
      type: 'select',
      points: 1,
      answers: [
        'AWS Config',
        'Amazon Augmented AI (A2I)',
        'Amazon Mechanical Turk',
        'Amazon Rekognition',
      ],
      correctAnswer: 1,
      explanation:
        'A2I crea flujos de trabajo en los que las predicciones dudosas las revisa una persona antes de tomar una decisión final.',
    },
    {
      id: 'servicios-14',
      title: 'Una empresa necesita que miles de personas etiqueten imágenes de un dataset pagando por tarea. ¿Qué servicio usa?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon Mechanical Turk',
        'Amazon Forecast',
        'Amazon Polly',
        'Amazon PartyRock',
      ],
      correctAnswer: 0,
      explanation:
        'Mechanical Turk es un marketplace de tareas realizadas por humanos y se integra con A2I y SageMaker Ground Truth.',
    },
    {
      id: 'servicios-15',
      title: '¿Qué es Amazon PartyRock?',
      type: 'select',
      points: 1,
      answers: [
        'Un playground de demostración de IA generativa basado en Bedrock que no es apto para producción',
        'Un chip de AWS para entrenar modelos',
        'Un servicio de producción para desplegar chatbots a gran escala',
        'Un servicio de etiquetado de datos',
      ],
      correctAnswer: 0,
      explanation:
        'PartyRock permite crear apps de IA generativa con prompts, gratis con login, pero no es production-grade.',
    },
    {
      id: 'servicios-16',
      title: '¿Qué caracteriza a la capa «AI Services» del panorama de IA/ML de AWS?',
      type: 'select',
      points: 1,
      answers: [
        'Son instancias EC2 con GPU para entrenar',
        'Son servicios gestionados con modelos ya entrenados que se invocan por API sin necesidad de conocimientos de ML',
        'Son frameworks de código abierto como PyTorch y TensorFlow',
        'Exigen entrenar el modelo desde cero con datos propios',
      ],
      correctAnswer: 1,
      explanation:
        'La pila tiene tres capas: AI Services (Rekognition, Comprehend...), ML Services (SageMaker) y ML Frameworks e infraestructura (PyTorch, Trainium, Inferentia...).',
    },
    {
      id: 'servicios-17',
      title: 'Una empresa sanitaria quiere extraer condiciones médicas, medicamentos y dosis de notas clínicas no estructuradas. ¿Qué servicio usa?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon Transcribe Medical',
        'Amazon Comprehend Medical',
        'Amazon Polly',
        'Amazon Rekognition',
      ],
      correctAnswer: 1,
      explanation:
        'Comprehend Medical es la versión de Comprehend para texto clínico. Transcribe Medical, en cambio, convierte conversaciones médicas de voz a texto.',
    },
    {
      id: 'servicios-18',
      title: '¿Qué fuentes de datos puede conectar Amazon Q Business mediante conectores?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Amazon Rekognition',
        'Amazon S3',
        'AWS CloudTrail',
        'Microsoft 365',
        'Slack',
      ],
      correctAnswer: [1, 3, 4],
      explanation:
        'Q Business tiene conectores nativos con servicios de AWS (S3, RDS, Aurora) y de terceros (Microsoft 365, Salesforce, Google Drive, Gmail, Slack) y plugins como Jira o ServiceNow.',
    },
    {
      id: 'servicios-19',
      title: '¿Qué capacidades ofrece Amazon Rekognition?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Moderación de contenido inapropiado',
        'Extracción de pares clave-valor de formularios',
        'Comparación de rostros para verificar identidad',
        'Conversión de texto a voz',
        'Detección de objetos, personas y escenas',
      ],
      correctAnswer: [0, 2, 4],
      explanation:
        'Rekognition analiza imágenes y vídeo con Deep Learning. La conversión de texto a voz es de Polly y la extracción de formularios, de Textract.',
    },
    {
      id: 'servicios-20',
      title: '¿Qué servicios trabajan con voz o audio?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Amazon Personalize',
        'Amazon Polly',
        'Amazon Transcribe',
        'Amazon Lex',
        'Amazon Textract',
      ],
      correctAnswer: [1, 2, 3],
      explanation:
        'Polly sintetiza voz, Transcribe convierte voz en texto y Lex soporta conversaciones por voz y texto. Textract trabaja con documentos y Personalize con recomendaciones.',
    },
    {
      id: 'servicios-21',
      title: '¿Qué análisis puede realizar Amazon Comprehend sobre un texto?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Moderación de imágenes',
        'Conversión de voz a texto',
        'Análisis de sentimiento',
        'Extracción de entidades',
        'Detección de idioma',
      ],
      correctAnswer: [2, 3, 4],
      explanation:
        'Comprehend también extrae frases clave, clasifica documentos y modela tópicos. La voz a texto es de Transcribe y las imágenes son de Rekognition.',
    },
    {
      id: 'servicios-22',
      title: 'Relaciona cada servicio con lo que recibe y lo que devuelve',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'Amazon Rekognition', right: 'Imágenes y vídeo → etiquetas, rostros y texto' },
        { left: 'Amazon Textract', right: 'Documentos escaneados → texto, tablas y formularios estructurados' },
        { left: 'Amazon Polly', right: 'Texto → audio con voz sintetizada' },
        { left: 'Amazon Transcribe', right: 'Audio → texto transcrito' },
      ],
      explanation:
        'Identificar entrada y salida de cada servicio es la forma más rápida de resolver las preguntas de elección de servicio.',
    },
    {
      id: 'servicios-23',
      title: 'Relaciona cada escenario con el servicio de AWS más adecuado',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'Recomendar productos distintos a cada cliente', right: 'Amazon Personalize' },
        { left: 'Predecir la demanda de inventario', right: 'Amazon Forecast' },
        { left: 'Buscar respuestas en la documentación corporativa', right: 'Amazon Kendra' },
        { left: 'Traducir comunicaciones de soporte', right: 'Amazon Translate' },
      ],
      explanation:
        'Las preguntas del examen suelen describir un caso de uso y pedir el servicio gestionado que lo resuelve sin entrenar un modelo propio.',
    },
    {
      id: 'servicios-24',
      title: 'Relaciona cada servicio con su función',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'Amazon Q Business', right: 'Asistente para empleados que usa los datos y el conocimiento de la empresa' },
        { left: 'Amazon Q Developer', right: 'Asistente de desarrollo integrado en IDEs y en la consola de AWS' },
        { left: 'Amazon Bedrock', right: 'Acceso a Foundation Models de varios proveedores mediante una API' },
        { left: 'Amazon SageMaker', right: 'Plataforma para construir, entrenar y desplegar modelos de ML propios' },
      ],
      explanation:
        'Q es el asistente gestionado (sin elegir modelo), Bedrock da acceso a los modelos fundacionales y SageMaker cubre el ciclo de vida completo del ML personalizado.',
    },
    {
      id: 'servicios-25',
      title: 'Clasifica cada elemento según la capa de la pila de IA/ML de AWS a la que pertenece',
      type: 'classify',
      points: 4,
      categories: ['AI Services', 'ML Services', 'ML Frameworks e infraestructura'],
      classifyItems: [
        { text: 'PyTorch', category: 'ML Frameworks e infraestructura' },
        { text: 'Amazon Comprehend', category: 'AI Services' },
        { text: 'AWS Trainium', category: 'ML Frameworks e infraestructura' },
        { text: 'Amazon SageMaker', category: 'ML Services' },
        { text: 'Amazon Rekognition', category: 'AI Services' },
        { text: 'Amazon Polly', category: 'AI Services' },
      ],
      explanation:
        'AI Services son modelos preentrenados por API; ML Services (SageMaker) cubre el ciclo de vida de modelos propios; la capa base aporta frameworks y aceleradores como Trainium e Inferentia.',
    },
    {
      id: 'servicios-26',
      title: 'Clasifica cada servicio según el tipo de dato que recibe como entrada',
      type: 'classify',
      points: 4,
      categories: ['Imágenes y vídeo', 'Texto', 'Audio'],
      classifyItems: [
        { text: 'Amazon Translate', category: 'Texto' },
        { text: 'Amazon Comprehend', category: 'Texto' },
        { text: 'Amazon Transcribe', category: 'Audio' },
        { text: 'Amazon Polly', category: 'Texto' },
        { text: 'Amazon Transcribe Medical', category: 'Audio' },
        { text: 'Amazon Rekognition', category: 'Imágenes y vídeo' },
      ],
      explanation:
        'Polly recibe texto y devuelve voz; Transcribe recibe audio y devuelve texto; Rekognition procesa imágenes y vídeo; Comprehend y Translate trabajan sobre texto.',
    },
    {
      id: 'servicios-27',
      title: 'Clasifica cada característica según corresponda a Amazon Q Business o a Amazon Q Developer',
      type: 'classify',
      points: 4,
      categories: ['Amazon Q Business', 'Amazon Q Developer'],
      classifyItems: [
        { text: 'Responde preguntas con documentos de S3 y SharePoint', category: 'Amazon Q Business' },
        { text: 'Usa plugins como Jira, ServiceNow o Zendesk', category: 'Amazon Q Business' },
        { text: 'Ayuda a escribir y depurar código en el IDE', category: 'Amazon Q Developer' },
        { text: 'Optimiza código existente', category: 'Amazon Q Developer' },
        { text: 'El administrador define guardrails y controles por tema', category: 'Amazon Q Business' },
        { text: 'Explica y ayuda a comprender la infraestructura de AWS desde la consola', category: 'Amazon Q Developer' },
      ],
      explanation:
        'Q Business es para conocimiento empresarial (datos internos, con control de acceso por usuario); Q Developer es para asistencia en el desarrollo de software.',
    },
  ],
};

export const testDominio1: TestConfig = {
  id: 'aif-d1',
  title: 'Dominio 1 · Fundamentos de IA y ML',
  numberOfQuestions: 15,
  time: 20,
  pointsType: 'over10',
  minForPass: 6,
  onTimeUp: 'warn',
  questions: [
    {
      id: 'd1-1',
      title: '¿Cuál es la jerarquía correcta entre disciplinas, de la más amplia a la más específica?',
      type: 'select',
      points: 1,
      answers: [
        'IA generativa > Deep Learning > Machine Learning > IA',
        'IA > Machine Learning > Deep Learning > IA generativa',
        'Deep Learning > Machine Learning > IA generativa > IA',
        'Machine Learning > IA > Deep Learning > IA generativa',
      ],
      correctAnswer: 1,
      explanation:
        'Cada nivel es un subconjunto del anterior. No toda la IA es ML (un sistema de reglas no aprende de datos) ni todo el ML es Deep Learning (un árbol de decisión no usa redes neuronales).',
    },
    {
      id: 'd1-2',
      title: '¿Qué caracteriza al aprendizaje supervisado?',
      type: 'select',
      points: 1,
      answers: [
        'Se entrena con datos que incluyen las features y las etiquetas (respuestas correctas)',
        'Un agente aprende mediante recompensas y penalizaciones',
        'Se entrena con datos sin etiquetar para descubrir agrupaciones',
        'No necesita datos de entrenamiento',
      ],
      correctAnswer: 0,
      explanation:
        'En el aprendizaje supervisado el modelo aprende la relación entre entradas y salidas conocidas para predecir la etiqueta de datos nuevos.',
    },
    {
      id: 'd1-3',
      title: 'Se quiere predecir el precio de una vivienda a partir de su superficie y ubicación. ¿Qué tipo de tarea es?',
      type: 'select',
      points: 1,
      answers: [
        'Reducción de dimensionalidad',
        'Clustering',
        'Clasificación',
        'Regresión',
      ],
      correctAnswer: 3,
      explanation:
        'La regresión predice un valor numérico continuo, como un precio, unas ventas futuras o una temperatura.',
    },
    {
      id: 'd1-4',
      title: 'Se quiere determinar si un correo es spam o no spam. ¿Qué tipo de tarea es?',
      type: 'select',
      points: 1,
      answers: [
        'Clustering',
        'Clasificación',
        'Regresión',
        'Aprendizaje por refuerzo',
      ],
      correctAnswer: 1,
      explanation:
        'La clasificación predice una categoría discreta dentro de un conjunto finito de opciones.',
    },
    {
      id: 'd1-5',
      title: 'Una empresa quiere segmentar a sus clientes por comportamiento de compra sin tener etiquetas previas. ¿Qué enfoque es el adecuado?',
      type: 'select',
      points: 1,
      answers: [
        'Aprendizaje supervisado (regresión)',
        'Aprendizaje por refuerzo',
        'Aprendizaje no supervisado (clustering)',
        'Aprendizaje supervisado (clasificación)',
      ],
      correctAnswer: 2,
      explanation:
        'Sin etiquetas, el objetivo es descubrir estructuras ocultas: clustering. El modelo identifica grupos naturales sin saber de antemano cuántos hay ni cómo son.',
    },
    {
      id: 'd1-6',
      title: 'Un robot aprende a caminar probando acciones y recibiendo una recompensa cuando avanza. ¿Qué tipo de aprendizaje es?',
      type: 'select',
      points: 1,
      answers: [
        'Aprendizaje supervisado',
        'Aprendizaje no supervisado',
        'Aprendizaje por refuerzo',
        'Transfer learning',
      ],
      correctAnswer: 2,
      explanation:
        'En el refuerzo un agente interactúa con un entorno y aprende a maximizar la recompensa acumulada. RLHF aplica esta idea con feedback humano para alinear chatbots.',
    },
    {
      id: 'd1-7',
      title: '¿Para qué se utiliza PCA (Principal Component Analysis)?',
      type: 'select',
      points: 1,
      answers: [
        'Para clasificar imágenes en categorías',
        'Para reducir la dimensionalidad conservando la mayor varianza posible',
        'Para predecir valores numéricos continuos',
        'Para entrenar agentes por refuerzo',
      ],
      correctAnswer: 1,
      explanation:
        'PCA transforma las features originales en componentes principales que capturan la máxima varianza con menos dimensiones.',
    },
    {
      id: 'd1-8',
      title: '¿Qué particularidad tiene el algoritmo K-Means?',
      type: 'select',
      points: 1,
      answers: [
        'Solo sirve para regresión',
        'Calcula automáticamente el número óptimo de clusters sin ninguna indicación',
        'Hay que indicar de antemano el número K de clusters',
        'Necesita datos etiquetados',
      ],
      correctAnswer: 2,
      explanation:
        'K-Means es el algoritmo de clustering más popular: asigna cada dato al cluster cuyo centroide está más cerca, y requiere fijar K.',
    },
    {
      id: 'd1-9',
      title: 'A pesar de su nombre, ¿qué tipo de tarea resuelve la regresión logística?',
      type: 'select',
      points: 1,
      answers: [
        'Reducción de dimensionalidad',
        'Clustering',
        'Clasificación',
        'Regresión de valores continuos',
      ],
      correctAnswer: 2,
      explanation:
        'La regresión logística usa una función sigmoide para convertir una combinación lineal de features en una probabilidad entre 0 y 1, ideal para clasificación binaria.',
    },
    {
      id: 'd1-10',
      title: '¿Qué ventaja aporta un Random Forest frente a un único árbol de decisión?',
      type: 'select',
      points: 1,
      answers: [
        'Solo se puede usar con datos sin etiquetas',
        'No necesita datos de entrenamiento',
        'Es más fácil de interpretar visualmente',
        'Combina muchos árboles y reduce de forma significativa el overfitting',
      ],
      correctAnswer: 3,
      explanation:
        'Un Random Forest es un ensemble: promedia (regresión) o vota (clasificación) las predicciones de muchos árboles, lo que lo hace más robusto aunque menos interpretable.',
    },
    {
      id: 'd1-11',
      title: '¿Qué diferencia a un hiperparámetro de un parámetro de un modelo?',
      type: 'select',
      points: 1,
      answers: [
        'El parámetro solo existe en modelos no supervisados',
        'El hiperparámetro se define antes del entrenamiento; el parámetro lo ajusta el modelo durante el entrenamiento',
        'El hiperparámetro lo aprende el modelo y el parámetro lo fija el ingeniero',
        'No hay ninguna diferencia',
      ],
      correctAnswer: 1,
      explanation:
        'Learning rate, número de capas o número de árboles son hiperparámetros; los pesos de una red neuronal o los coeficientes de una regresión son parámetros.',
    },
    {
      id: 'd1-12',
      title: '¿Para qué se debe usar el conjunto de test (test set)?',
      type: 'select',
      points: 1,
      answers: [
        'Para ajustar los hiperparámetros durante el entrenamiento',
        'Para la evaluación final del modelo con datos que nunca ha visto, sin usarlo para entrenar ni elegir hiperparámetros',
        'Para entrenar el modelo cuando faltan datos',
        'Para aplicar early stopping',
      ],
      correctAnswer: 1,
      explanation:
        'Si el test set se contamina con información del proceso de entrenamiento, las métricas dejan de reflejar el rendimiento real en producción.',
    },
    {
      id: 'd1-13',
      title: 'Un 95 % de los correos no son spam y un modelo que siempre predice «no spam» obtiene un 95 % de accuracy. ¿Qué enseña este ejemplo?',
      type: 'select',
      points: 1,
      answers: [
        'Que el modelo es excelente',
        'Que la accuracy puede ser engañosa en datasets desequilibrados',
        'Que el modelo sufre underfitting por falta de epochs',
        'Que se debe usar RMSE en lugar de accuracy',
      ],
      correctAnswer: 1,
      explanation:
        'En datasets desequilibrados conviene usar precision, recall o F1-score, que revelan el rendimiento real sobre la clase minoritaria.',
    },
    {
      id: 'd1-14',
      title: 'En el diagnóstico de una enfermedad grave, no detectar un caso positivo es muy costoso. ¿Qué métrica debe priorizarse?',
      type: 'select',
      points: 1,
      answers: [
        'Precision',
        'Recall (sensibilidad)',
        'RMSE',
        'Accuracy',
      ],
      correctAnswer: 1,
      explanation:
        'Recall mide qué proporción de los positivos reales detecta el modelo; es la métrica clave cuando los falsos negativos son costosos.',
    },
    {
      id: 'd1-15',
      title: 'Un sistema de detección de fraude genera demasiadas falsas alarmas. ¿Qué métrica conviene mejorar?',
      type: 'select',
      points: 1,
      answers: [
        'Perplexity',
        'Precision',
        'Recall',
        'MAE',
      ],
      correctAnswer: 1,
      explanation:
        'Precision indica qué proporción de las predicciones positivas son realmente positivas; es la clave cuando los falsos positivos son costosos.',
    },
    {
      id: 'd1-16',
      title: '¿Qué métrica se usa habitualmente para evaluar la calidad de resúmenes generados automáticamente?',
      type: 'select',
      points: 1,
      answers: [
        'AUC-ROC',
        'RMSE',
        'ROUGE',
        'BLEU',
      ],
      correctAnswer: 2,
      explanation:
        'ROUGE compara el solapamiento de n-gramas con resúmenes de referencia. BLEU se usa en traducción automática y perplexity mide cómo de bien predice un modelo de lenguaje.',
    },
    {
      id: 'd1-17',
      title: 'Un modelo tiene un rendimiento excelente en los datos de entrenamiento pero muy pobre con datos nuevos. ¿Qué le ocurre?',
      type: 'select',
      points: 1,
      answers: [
        'Está bien generalizado',
        'Underfitting (subajuste)',
        'Overfitting (sobreajuste)',
        'Alto sesgo (bias) con baja varianza',
      ],
      correctAnswer: 2,
      explanation:
        'El overfitting aparece por modelos demasiado complejos, pocos datos o demasiadas epochs: el modelo memoriza ruido en lugar de patrones generalizables.',
    },
    {
      id: 'd1-18',
      title: '¿Qué fase del ciclo de vida de ML suele consumir entre el 60 % y el 80 % del tiempo del proyecto?',
      type: 'select',
      points: 1,
      answers: [
        'La definición del problema de negocio',
        'La preparación de los datos',
        'La monitorización',
        'El despliegue del modelo',
      ],
      correctAnswer: 1,
      explanation:
        'Limpiar, transformar e integrar los datos en bruto es la fase más laboriosa; la calidad de los datos determina el rendimiento final.',
    },
    {
      id: 'd1-19',
      title: 'Un modelo que funcionaba bien hace seis meses pierde precisión porque los datos del mundo real han cambiado. ¿Qué fenómeno describe esto?',
      type: 'select',
      points: 1,
      answers: [
        'Feature engineering',
        'Overfitting',
        'Data augmentation',
        'Model drift (degradación del rendimiento)',
      ],
      correctAnswer: 3,
      explanation:
        'La monitorización continua detecta la degradación y puede disparar un reentrenamiento.',
    },
    {
      id: 'd1-20',
      title: '¿Qué estrategias ayudan a reducir el overfitting?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Aumentar el número de epochs sin límite',
        'Dropout en redes neuronales',
        'Regularización L1/L2',
        'Usar un modelo más complejo',
        'Early stopping',
      ],
      correctAnswer: [1, 2, 4],
      explanation:
        'Otras estrategias: cross-validation, data augmentation y más datos de entrenamiento. Entrenar más o complicar el modelo empeora el overfitting.',
    },
    {
      id: 'd1-21',
      title: '¿Cuáles son causas típicas del underfitting?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Usar un modelo demasiado simple para el problema',
        'Disponer de pocas features relevantes',
        'Entrenar el modelo durante demasiadas epochs',
        'Entrenar durante muy pocas epochs',
        'Memorizar el ruido de los datos de entrenamiento',
      ],
      correctAnswer: [0, 1, 3],
      explanation:
        'En el underfitting el modelo no captura los patrones: rinde mal tanto en entrenamiento como en test. Memorizar ruido es overfitting.',
    },
    {
      id: 'd1-22',
      title: '¿Cuáles de las siguientes son métricas de clasificación?',
      type: 'multiselect',
      points: 2,
      answers: [
        'MAE',
        'RMSE',
        'F1-Score',
        'Recall',
        'Precision',
      ],
      correctAnswer: [2, 3, 4],
      explanation:
        'RMSE y MAE miden el error de modelos de regresión. Precision, recall, F1, accuracy y AUC-ROC evalúan clasificación.',
    },
    {
      id: 'd1-23',
      title: '¿Cuáles de los siguientes son ejemplos de aprendizaje no supervisado?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Reducir 200 variables a 10 componentes con PCA',
        'Agrupar clientes por comportamiento sin etiquetas previas',
        'Clasificar correos usando ejemplos etiquetados como spam',
        'Descubrir grupos naturales en datos de sensores sin etiquetar',
        'Predecir el precio de una vivienda con precios históricos',
      ],
      correctAnswer: [0, 1, 3],
      explanation:
        'El no supervisado trabaja sin etiquetas (clustering y reducción de dimensionalidad). Predecir precios o clasificar con ejemplos etiquetados es aprendizaje supervisado.',
    },
    {
      id: 'd1-24',
      title: 'Relaciona cada término de ML con su definición',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'Feature', right: 'Variable de entrada que el modelo usa para predecir' },
        { left: 'Label', right: 'Respuesta correcta que el modelo intenta predecir en aprendizaje supervisado' },
        { left: 'Epoch', right: 'Una pasada completa por todo el dataset de entrenamiento' },
        { left: 'Learning rate', right: 'Tamaño del paso en cada actualización de parámetros' },
      ],
      explanation:
        'Un learning rate demasiado alto impide la convergencia; uno demasiado bajo hace el entrenamiento muy lento.',
    },
    {
      id: 'd1-25',
      title: 'Relaciona cada algoritmo con el tipo de tarea que resuelve',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'Linear Regression', right: 'Regresión' },
        { left: 'Logistic Regression', right: 'Clasificación binaria' },
        { left: 'K-Means', right: 'Clustering' },
        { left: 'PCA', right: 'Reducción de dimensionalidad' },
      ],
      explanation:
        'Linear y Logistic Regression son supervisados; K-Means y PCA son no supervisados.',
    },
    {
      id: 'd1-26',
      title: 'Relaciona cada métrica de clasificación con lo que mide',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'Precision', right: 'De las predicciones positivas, cuántas eran realmente positivas' },
        { left: 'Recall', right: 'De los positivos reales, cuántos detecta el modelo' },
        { left: 'F1-Score', right: 'Media armónica de precision y recall' },
        { left: 'AUC-ROC', right: 'Capacidad de distinguir entre clases en todos los umbrales de decisión' },
      ],
      explanation:
        'Un AUC-ROC de 1,0 indica un modelo perfecto y 0,5 uno que no es mejor que el azar.',
    },
    {
      id: 'd1-27',
      title: 'Clasifica cada tarea según su tipo',
      type: 'classify',
      points: 4,
      categories: ['Clasificación', 'Regresión', 'Clustering'],
      classifyItems: [
        { text: 'Segmentar clientes por comportamiento', category: 'Clustering' },
        { text: 'Calcular la temperatura esperada mañana', category: 'Regresión' },
        { text: 'Agrupar noticias por temas sin etiquetas previas', category: 'Clustering' },
        { text: 'Predecir si un correo es spam', category: 'Clasificación' },
        { text: 'Diagnosticar si un paciente tiene una enfermedad', category: 'Clasificación' },
        { text: 'Estimar las ventas del próximo trimestre', category: 'Regresión' },
      ],
      explanation:
        'Clasificación predice categorías, regresión predice valores continuos y clustering descubre grupos sin etiquetas.',
    },
    {
      id: 'd1-28',
      title: 'Clasifica cada descripción según el conjunto de datos al que corresponde',
      type: 'classify',
      points: 4,
      categories: ['Training set', 'Validation set', 'Test set'],
      classifyItems: [
        { text: 'Permite decidir cuándo aplicar early stopping', category: 'Validation set' },
        { text: 'Se usa para ajustar los parámetros internos del modelo', category: 'Training set' },
        { text: 'Nunca debe utilizarse para elegir hiperparámetros', category: 'Test set' },
        { text: 'Suele ser el 70-80 % de los datos', category: 'Training set' },
        { text: 'Evaluación final con datos completamente independientes', category: 'Test set' },
        { text: 'Se usa para ajustar hiperparámetros y detectar overfitting durante el entrenamiento', category: 'Validation set' },
      ],
      explanation:
        'Un reparto típico es 70-80 % entrenamiento, 10-15 % validación y 10-15 % test.',
    },
    {
      id: 'd1-29',
      title: 'Clasifica cada síntoma o causa según sea overfitting o underfitting',
      type: 'classify',
      points: 4,
      categories: ['Overfitting', 'Underfitting'],
      classifyItems: [
        { text: 'Rendimiento excelente en entrenamiento y pobre con datos nuevos', category: 'Overfitting' },
        { text: 'Alto sesgo (bias)', category: 'Underfitting' },
        { text: 'Alta varianza', category: 'Overfitting' },
        { text: 'Modelo demasiado complejo que memoriza el ruido', category: 'Overfitting' },
        { text: 'Modelo demasiado simple para el problema', category: 'Underfitting' },
        { text: 'Rendimiento pobre tanto en entrenamiento como en test', category: 'Underfitting' },
      ],
      explanation:
        'Alto bias implica underfitting; alta varianza implica overfitting. El objetivo es el punto óptimo que mejor generaliza.',
    },
  ],
};

export const testDominio2: TestConfig = {
  id: 'aif-d2',
  title: 'Dominio 2 · IA generativa y Amazon Bedrock',
  numberOfQuestions: 15,
  time: 20,
  pointsType: 'over10',
  minForPass: 6,
  onTimeUp: 'warn',
  questions: [
    {
      id: 'd2-1',
      title: '¿Qué distingue a la IA generativa de la IA discriminativa tradicional?',
      type: 'select',
      points: 1,
      answers: [
        'La generativa solo clasifica imágenes y la tradicional solo texto',
        'La generativa no necesita datos de entrenamiento',
        'La tradicional siempre usa Transformers',
        'La generativa crea contenido nuevo similar a los datos de entrenamiento; la tradicional analiza y clasifica datos existentes',
      ],
      correctAnswer: 3,
      explanation:
        'Los modelos generativos aprenden la distribución de los datos y generan nuevas muestras: texto, imágenes, audio, código o vídeo.',
    },
    {
      id: 'd2-2',
      title: '¿Con qué tipo de datos se pre-entrena normalmente un Foundation Model?',
      type: 'select',
      points: 1,
      answers: [
        'Únicamente datos tabulares estructurados',
        'Pequeños datasets completamente etiquetados a mano',
        'Enormes volúmenes de datos diversos y sin etiquetar',
        'Datos sintéticos generados por reglas fijas',
      ],
      correctAnswer: 2,
      explanation:
        'El pre-entrenamiento con datos no etiquetados reduce el coste de preparación de datos; después el modelo se adapta a tareas concretas con fine-tuning o prompt engineering.',
    },
    {
      id: 'd2-3',
      title: '¿Por qué un LLM puede dar respuestas distintas al mismo prompt?',
      type: 'select',
      points: 1,
      answers: [
        'Porque cada petición se ejecuta en un modelo distinto',
        'Porque el modelo se reentrena en cada petición',
        'Porque Bedrock modifica el prompt de forma aleatoria',
        'Porque es no determinista: muestrea el siguiente token entre los más probables según los parámetros de inferencia',
      ],
      correctAnswer: 3,
      explanation:
        'La variabilidad depende de parámetros como temperature, top-k y top-p. Los LLM no procesan palabras, sino tokens.',
    },
    {
      id: 'd2-4',
      title: '¿Cómo se llama la cantidad de tokens que un modelo puede procesar en una sola solicitud?',
      type: 'select',
      points: 1,
      answers: [
        'Embedding',
        'Learning rate',
        'Context window (ventana de contexto)',
        'Batch size',
      ],
      correctAnswer: 2,
      explanation:
        'La ventana de contexto es una de las limitaciones prácticas más importantes de los LLM; además, el precio de los modelos se mide en tokens.',
    },
    {
      id: 'd2-5',
      title: '¿Cuál es la innovación clave de la arquitectura Transformer?',
      type: 'select',
      points: 1,
      answers: [
        'El procesamiento secuencial palabra a palabra mediante redes recurrentes',
        'La compresión del modelo mediante cuantización',
        'El uso exclusivo de reglas gramaticales codificadas',
        'El mecanismo de atención, que evalúa la importancia de cada token respecto a todos los demás de la secuencia',
      ],
      correctAnswer: 3,
      explanation:
        'La self-attention permite capturar relaciones de largo alcance y procesar los tokens en paralelo; el positional encoding aporta la información de orden.',
    },
    {
      id: 'd2-6',
      title: '¿Cómo generan imágenes los modelos de difusión (Diffusion Models)?',
      type: 'select',
      points: 1,
      answers: [
        'Enfrentando un generador y un discriminador',
        'Traduciendo píxeles a tokens de texto',
        'Copiando imágenes de una base de datos',
        'Partiendo de ruido aleatorio y refinándolo progresivamente hasta obtener una imagen coherente',
      ],
      correctAnswer: 3,
      explanation:
        'Stable Diffusion o DALL-E son ejemplos. La competición entre generador y discriminador es característica de las GAN.',
    },
    {
      id: 'd2-7',
      title: '¿Qué es Amazon Bedrock?',
      type: 'select',
      points: 1,
      answers: [
        'Un servicio de búsqueda empresarial basado en palabras clave',
        'Un servicio totalmente gestionado que da acceso a Foundation Models de varios proveedores mediante una API unificada',
        'Un servicio para etiquetar datos con trabajadores humanos',
        'Un chip de AWS para inferencia',
      ],
      correctAnswer: 1,
      explanation:
        'Bedrock ofrece modelos de Anthropic, Meta, Amazon (Titan), Stability AI, Cohere, AI21 Labs o Mistral sin gestionar infraestructura.',
    },
    {
      id: 'd2-8',
      title: '¿Qué ocurre con los datos que un cliente envía a Amazon Bedrock?',
      type: 'select',
      points: 1,
      answers: [
        'Se publican en el catálogo de datos de AWS',
        'Se utilizan para reentrenar los modelos de todos los clientes',
        'Se conservan siempre sin cifrar',
        'No se usan para entrenar los modelos base ni se comparten con otros clientes',
      ],
      correctAnswer: 3,
      explanation:
        'Bedrock protege la información del cliente y se integra con IAM, CloudWatch y CloudTrail para control de acceso, monitorización y auditoría.',
    },
    {
      id: 'd2-9',
      title: '¿Qué función cumplen las Knowledge Bases de Amazon Bedrock?',
      type: 'select',
      points: 1,
      answers: [
        'Implementan RAG de forma gestionada: chunking, embeddings e indexación de fuentes de datos como S3',
        'Gestionan los permisos IAM de los usuarios',
        'Bloquean temas no deseados en las respuestas',
        'Reentrenan el modelo base con los documentos del cliente',
      ],
      correctAnswer: 0,
      explanation:
        'Las Knowledge Bases conectan fuentes externas para que el modelo responda con información actualizada y específica del dominio.',
    },
    {
      id: 'd2-10',
      title: '¿Qué problema de los LLM resuelve principalmente RAG?',
      type: 'select',
      points: 1,
      answers: [
        'Que no pueden procesar más de una pregunta a la vez',
        'Que no pueden generar texto en varios idiomas',
        'Que su conocimiento termina en la fecha de corte del entrenamiento y no incluye información privada, reduciendo además las alucinaciones',
        'Que consumen demasiados tokens de salida',
      ],
      correctAnswer: 2,
      explanation:
        'RAG recupera información actualizada y propia antes de generar la respuesta, sin reentrenar el modelo, y puede citar los documentos fuente.',
    },
    {
      id: 'd2-11',
      title: '¿Qué es un embedding?',
      type: 'select',
      points: 1,
      answers: [
        'Una regla de filtrado de contenido',
        'Una representación numérica (vector) que captura el significado semántico de un dato',
        'Un tipo de instancia con GPU',
        'Un fragmento de texto de un documento grande',
      ],
      correctAnswer: 1,
      explanation:
        'Los datos con significados similares tienen embeddings cercanos; son la base de la búsqueda semántica y del retrieval en RAG.',
    },
    {
      id: 'd2-12',
      title: '¿Qué servicio de AWS es la opción principal citada para implementar búsqueda vectorial de embeddings?',
      type: 'select',
      points: 1,
      answers: [
        'AWS CloudTrail',
        'Amazon OpenSearch',
        'Amazon Athena',
        'Amazon Glue',
      ],
      correctAnswer: 1,
      explanation:
        'Las vector databases permiten búsquedas por similitud en milisegundos. En AWS, OpenSearch es la opción principal y otras bases de datos como Aurora (pgvector) también la soportan.',
    },
    {
      id: 'd2-13',
      title: 'Un chatbot LLM produce respuestas muy diversas para el mismo prompt y se quiere que sean más consistentes. ¿Qué se debe hacer?',
      type: 'select',
      points: 1,
      answers: [
        'Reentrenar el modelo desde cero',
        'Reducir la temperature',
        'Aumentar la temperature',
        'Aumentar el número máximo de tokens',
      ],
      correctAnswer: 1,
      explanation:
        'Valores bajos de temperature (0-0,3) dan respuestas deterministas y conservadoras; valores altos (0,7-1,0) las hacen más creativas y variadas.',
    },
    {
      id: 'd2-14',
      title: 'Se quiere que el modelo elija únicamente entre los 5 tokens más probables en cada paso. ¿Qué parámetro se ajusta?',
      type: 'select',
      points: 1,
      answers: [
        'Max tokens = 5',
        'Temperature = 5',
        'Top-k = 5',
        'Top-p = 5',
      ],
      correctAnswer: 2,
      explanation:
        'Top-k limita la selección a los k tokens más probables. Top-p (nucleus sampling) selecciona dinámicamente tokens cuya probabilidad acumulada llega a p.',
    },
    {
      id: 'd2-15',
      title: 'Un prompt incluye unos pocos ejemplos de la tarea antes de la solicitud real. ¿Qué técnica es?',
      type: 'select',
      points: 1,
      answers: [
        'Chain-of-Thought',
        'Few-shot prompting',
        'Prompt injection',
        'Zero-shot prompting',
      ],
      correctAnswer: 1,
      explanation:
        'Zero-shot no incluye ejemplos; few-shot los incluye para guiar formato y tipo de respuesta; Chain-of-Thought pide razonar paso a paso.',
    },
    {
      id: 'd2-16',
      title: 'Los accionistas no están contentos con el tono de un chatbot basado en Bedrock. ¿Cuál es la forma más eficiente de corregirlo?',
      type: 'select',
      points: 1,
      answers: [
        'Cambiar a un modelo mucho más grande',
        'Hacer continued pre-training con un gran corpus',
        'Prompt engineering: indicar el tono deseado en las instrucciones',
        'Hacer fine-tuning del modelo con datos de tono',
      ],
      correctAnswer: 2,
      explanation:
        'Ajustar el prompt es mucho más barato y rápido que fine-tuning o cambiar de modelo. Es la primera palanca a probar.',
    },
    {
      id: 'd2-17',
      title: 'Un chatbot científico en Bedrock con RAG está al día con los últimos papers, pero falla con la terminología especializada. ¿Qué solución es la recomendada?',
      type: 'select',
      points: 1,
      answers: [
        'Aumentar el número de chunks recuperados',
        'Cambiar el modelo de embeddings',
        'Continued Pre-Training con un gran corpus del dominio científico',
        'Reducir la temperature a 0',
      ],
      correctAnswer: 2,
      explanation:
        'RAG aporta datos actualizados pero no enseña el lenguaje del dominio. El Continued Pre-Training amplía el conocimiento base del modelo en un área especializada.',
    },
    {
      id: 'd2-18',
      title: '¿Qué modalidad de precios de Bedrock reserva capacidad dedicada y es más económica para cargas predecibles de alto volumen?',
      type: 'select',
      points: 1,
      answers: [
        'Provisioned Throughput',
        'On-Demand',
        'Spot Instances',
        'Savings Plans de EC2',
      ],
      correctAnswer: 0,
      explanation:
        'On-Demand cobra por tokens de entrada y salida sin compromiso; Provisioned Throughput exige compromiso temporal a cambio de un rendimiento constante.',
    },
    {
      id: 'd2-19',
      title: '¿Qué puede hacer un Agent de Amazon Bedrock?',
      type: 'select',
      points: 1,
      answers: [
        'Almacenar los embeddings de los documentos',
        'Únicamente generar imágenes',
        'Ejecutar acciones y consultar fuentes de datos para completar tareas complejas de varios pasos',
        'Facturar el uso de tokens',
      ],
      correctAnswer: 2,
      explanation:
        'Un agente puede, por ejemplo, consultar una base de datos, invocar una función Lambda y devolver una respuesta compuesta.',
    },
    {
      id: 'd2-20',
      title: '¿Qué es el Model Context Protocol (MCP)?',
      type: 'select',
      points: 1,
      answers: [
        'Un chip de AWS para inferencia',
        'Un tipo de base de datos vectorial',
        'Un protocolo abierto de Anthropic que estandariza cómo las aplicaciones dan contexto y herramientas a los LLM',
        'Un algoritmo de reducción de dimensionalidad',
      ],
      correctAnswer: 2,
      explanation:
        'MCP se describe como «el USB-C de las aplicaciones de IA»: clientes MCP (como un Bedrock Agent) se conectan a servidores MCP que exponen tools y resources.',
    },
    {
      id: 'd2-21',
      title: '¿Qué fases componen un flujo RAG?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Dividir los documentos en chunks',
        'Reentrenar el LLM con los documentos',
        'Recuperar los chunks más similares a la consulta',
        'Eliminar el LLM del flujo de respuesta',
        'Generar embeddings de cada chunk',
      ],
      correctAnswer: [0, 2, 4],
      explanation:
        'RAG: chunking, encoding en embeddings, indexación en una vector database, retrieval por similitud y generación con la información recuperada como contexto.',
    },
    {
      id: 'd2-22',
      title: '¿Qué controles ofrece Guardrails for Amazon Bedrock?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Bloqueo de temas denegados',
        'Reentrenar el modelo base con feedback humano',
        'Ampliar la ventana de contexto del modelo',
        'Filtros de contenido dañino',
        'Detección y redacción de información personal (PII)',
      ],
      correctAnswer: [0, 3, 4],
      explanation:
        'Guardrails controla entradas y salidas: filtros de contenido, temas denegados, filtros de palabras y PII. Es la primera línea de defensa para respuestas seguras.',
    },
    {
      id: 'd2-23',
      title: '¿Cuáles son limitaciones de la IA generativa?',
      type: 'multiselect',
      points: 2,
      answers: [
        'No puede generar texto',
        'Conocimiento limitado a la fecha de corte del entrenamiento',
        'Sesgos heredados de los datos de entrenamiento',
        'Alucinaciones',
        'Necesita siempre datos etiquetados para pre-entrenar',
      ],
      correctAnswer: [1, 2, 3],
      explanation:
        'También hay riesgos de privacidad, falta de razonamiento real y coste computacional de la inferencia.',
    },
    {
      id: 'd2-24',
      title: '¿Qué parámetros de inferencia controlan la generación de un LLM?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Max tokens',
        'Top-p',
        'Temperature',
        'Learning rate',
        'Batch size',
      ],
      correctAnswer: [0, 1, 2],
      explanation:
        'Learning rate y batch size son hiperparámetros de entrenamiento, no de inferencia.',
    },
    {
      id: 'd2-25',
      title: 'Relaciona cada técnica de prompting con su descripción',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'Zero-shot', right: 'Pedir la tarea sin ofrecer ningún ejemplo' },
        { left: 'Few-shot', right: 'Incluir unos pocos ejemplos antes de la solicitud real' },
        { left: 'Chain-of-Thought', right: 'Pedir al modelo que razone paso a paso antes de responder' },
      ],
      explanation:
        'Chain-of-Thought mejora el rendimiento en tareas que requieren razonamiento lógico o matemático.',
    },
    {
      id: 'd2-26',
      title: 'Relaciona cada tipo de modelo generativo con su funcionamiento',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'LLM basado en Transformer', right: 'Predice el siguiente token usando el mecanismo de atención' },
        { left: 'Modelo de difusión', right: 'Parte de ruido aleatorio y lo refina hasta formar una imagen' },
        { left: 'GAN', right: 'Un generador y un discriminador compiten entre sí' },
        { left: 'VAE', right: 'Aprende una representación latente comprimida a partir de la cual genera nuevas muestras' },
      ],
      explanation:
        'Los modelos de difusión son hoy el estándar en generación de imágenes; las GAN fueron pioneras.',
    },
    {
      id: 'd2-27',
      title: 'Relaciona cada proveedor con un modelo disponible en Amazon Bedrock',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'Anthropic', right: 'Claude' },
        { left: 'Meta', right: 'Llama' },
        { left: 'Amazon', right: 'Titan' },
        { left: 'Stability AI', right: 'Stable Diffusion' },
      ],
      explanation:
        'Bedrock también incluye modelos de Cohere (Command, Embed), AI21 Labs (Jamba) y Mistral AI.',
    },
    {
      id: 'd2-28',
      title: 'Clasifica cada elemento como capacidad o como limitación de la IA generativa',
      type: 'classify',
      points: 4,
      categories: ['Capacidad', 'Limitación'],
      classifyItems: [
        { text: 'Chatbots de atención al cliente', category: 'Capacidad' },
        { text: 'Conocimiento desactualizado', category: 'Limitación' },
        { text: 'Sesgos presentes en los datos de entrenamiento', category: 'Limitación' },
        { text: 'Asistencia en programación y depuración', category: 'Capacidad' },
        { text: 'Alucinaciones', category: 'Limitación' },
        { text: 'Automatizar resúmenes y traducciones', category: 'Capacidad' },
      ],
      explanation:
        'La IA generativa automatiza tareas de conocimiento y crea contenido, pero puede inventar información, estar desactualizada y reproducir sesgos.',
    },
    {
      id: 'd2-29',
      title: 'Clasifica cada necesidad con la técnica más adecuada para resolverla',
      type: 'classify',
      points: 4,
      categories: ['Prompt engineering', 'RAG', 'Fine-tuning o Continued Pre-Training'],
      classifyItems: [
        { text: 'Cambiar el tono del chatbot rápidamente y sin coste de entrenamiento', category: 'Prompt engineering' },
        { text: 'Mejorar el conocimiento de terminología médica con un gran corpus del dominio', category: 'Fine-tuning o Continued Pre-Training' },
        { text: 'Reducir alucinaciones citando los documentos fuente', category: 'RAG' },
        { text: 'Adaptar el modelo a una tarea concreta con pares entrada-salida', category: 'Fine-tuning o Continued Pre-Training' },
        { text: 'Indicar con ejemplos el formato de salida deseado', category: 'Prompt engineering' },
        { text: 'Responder con documentos internos actualizados sin reentrenar el modelo', category: 'RAG' },
      ],
      explanation:
        'Primero prompt engineering (barato), después RAG para datos propios y actualizados, y entrenamiento adicional cuando hace falta modificar el conocimiento o el comportamiento del modelo.',
    },
    {
      id: 'd2-30',
      title: 'Clasifica cada ajuste de los parámetros de inferencia según su efecto',
      type: 'classify',
      points: 4,
      categories: ['Respuestas más deterministas', 'Respuestas más creativas y diversas'],
      classifyItems: [
        { text: 'Top-k alto (por ejemplo 500)', category: 'Respuestas más creativas y diversas' },
        { text: 'Temperature alta (0,9)', category: 'Respuestas más creativas y diversas' },
        { text: 'Top-p bajo', category: 'Respuestas más deterministas' },
        { text: 'Top-p alto', category: 'Respuestas más creativas y diversas' },
        { text: 'Top-k bajo (por ejemplo 5)', category: 'Respuestas más deterministas' },
        { text: 'Temperature baja (0,1)', category: 'Respuestas más deterministas' },
      ],
      explanation:
        'Valores bajos concentran la elección en los tokens más probables; valores altos permiten más variedad y creatividad.',
    },
  ],
};

export const testDominio3: TestConfig = {
  id: 'aif-d3',
  title: 'Dominio 3 · Entrenamiento, inferencia y SageMaker',
  numberOfQuestions: 15,
  time: 20,
  pointsType: 'over10',
  minForPass: 6,
  onTimeUp: 'warn',
  questions: [
    {
      id: 'd3-1',
      title: '¿Qué ocurre si el learning rate es demasiado alto?',
      type: 'select',
      points: 1,
      answers: [
        'El modelo aprende exclusivamente de los datos de test',
        'El entrenamiento se vuelve extremadamente lento',
        'Se garantiza que el modelo no sufra overfitting',
        'El modelo puede oscilar y no converger a una solución óptima',
      ],
      correctAnswer: 3,
      explanation:
        'Un learning rate demasiado bajo hace el entrenamiento muy lento. En la práctica se usa learning rate scheduling para reducirlo progresivamente.',
    },
    {
      id: 'd3-2',
      title: '¿Qué es una epoch?',
      type: 'select',
      points: 1,
      answers: [
        'El número de muestras que se procesan antes de actualizar los parámetros',
        'Una versión del modelo registrada en el Model Registry',
        'El tamaño del paso de cada actualización',
        'Una pasada completa por todo el dataset de entrenamiento',
      ],
      correctAnswer: 3,
      explanation:
        'El número de epochs determina cuántas veces ve el modelo los datos: pocas producen underfitting y demasiadas, overfitting. El early stopping detiene el entrenamiento cuando la validación deja de mejorar.',
    },
    {
      id: 'd3-3',
      title: '¿En qué consiste LoRA (Low-Rank Adaptation)?',
      type: 'select',
      points: 1,
      answers: [
        'En actualizar todos los parámetros del modelo con un dataset grande',
        'En entrenar solo unas matrices de baja dimensión añadidas al modelo, manteniendo congelados los pesos originales',
        'En reducir la precisión numérica de los pesos a 8 bits',
        'En entrenar al modelo con feedback humano y un modelo de recompensa',
      ],
      correctAnswer: 1,
      explanation:
        'LoRA actualiza menos del 1 % de los parámetros, reduce coste y memoria y evita el catastrophic forgetting. Es una técnica PEFT.',
    },
    {
      id: 'd3-4',
      title: '¿Cuál es el principal riesgo del full fine-tuning?',
      type: 'select',
      points: 1,
      answers: [
        'Que no se pueda aplicar a modelos de lenguaje',
        'Que solo funcione con datos sin etiquetar',
        'Que el modelo deje de aceptar prompts',
        'El catastrophic forgetting: el modelo pierde conocimiento adquirido en el pre-entrenamiento',
      ],
      correctAnswer: 3,
      explanation:
        'El full fine-tuning actualiza todos los parámetros, requiere datasets y hardware potentes y puede degradar el conocimiento general del modelo.',
    },
    {
      id: 'd3-5',
      title: '¿Qué técnica entrena un modelo con pares de instrucción-respuesta para que siga mejor las instrucciones?',
      type: 'select',
      points: 1,
      answers: [
        'Instruction tuning',
        'Continued pre-training',
        'Knowledge distillation',
        'Quantization',
      ],
      correctAnswer: 0,
      explanation:
        'El instruction tuning es lo que diferencia a un modelo base, que solo completa texto, de un modelo conversacional que responde a peticiones.',
    },
    {
      id: 'd3-6',
      title: '¿Qué servicio de SageMaker facilita recopilar feedback humano para RLHF y etiquetar datos?',
      type: 'select',
      points: 1,
      answers: [
        'SageMaker Data Wrangler',
        'SageMaker Model Monitor',
        'SageMaker Clarify',
        'SageMaker Ground Truth',
      ],
      correctAnswer: 3,
      explanation:
        'Ground Truth ofrece etiquetado de datos y feedback humano; la fuerza de trabajo puede ser Mechanical Turk, empleados propios o proveedores externos.',
    },
    {
      id: 'd3-7',
      title: '¿En qué se diferencia el Continued Pre-Training del Fine-Tuning?',
      type: 'select',
      points: 1,
      answers: [
        'El Continued Pre-Training usa pares de instrucción-respuesta y el Fine-Tuning grandes corpus de texto',
        'El Fine-Tuning no modifica los pesos del modelo',
        'No hay ninguna diferencia',
        'El Continued Pre-Training amplía el conocimiento de un dominio con grandes corpus; el Fine-Tuning adapta el modelo a una tarea concreta',
      ],
      correctAnswer: 3,
      explanation:
        'Continued Pre-Training: millones de documentos del dominio (por ejemplo, terminología médica). Fine-Tuning: miles o decenas de miles de ejemplos entrada-salida para una tarea.',
    },
    {
      id: 'd3-8',
      title: '¿Qué chip de AWS está diseñado para entrenar modelos y a qué instancias EC2 da servicio?',
      type: 'select',
      points: 1,
      answers: [
        'AWS Graviton, en las instancias G5',
        'AWS Trainium, en las instancias Trn1',
        'AWS Nitro, en las instancias P5',
        'AWS Inferentia, en las instancias Inf1',
      ],
      correctAnswer: 1,
      explanation:
        'Trainium = training (hasta un 50 % menos de coste de entrenamiento) e Inferentia = inferencia (hasta un 70 % menos de coste por inferencia).',
    },
    {
      id: 'd3-9',
      title: 'Una empresa quiere reducir el coste de ejecutar predicciones de un modelo en producción. ¿Qué opción de AWS le conviene?',
      type: 'select',
      points: 1,
      answers: [
        'Instancias Inf1 con chips AWS Inferentia',
        'Instancias de almacenamiento optimizado',
        'Instancias Trn1 con chips AWS Trainium',
        'Instancias P4d con GPUs A100 para entrenar',
      ],
      correctAnswer: 0,
      explanation:
        'Inferentia está optimizado para inferencia de bajo coste. A largo plazo, el coste acumulado de inferencia suele superar al de entrenamiento.',
    },
    {
      id: 'd3-10',
      title: 'Un modelo analiza los fotogramas de un partido de tenis y debe predecir en tiempo real quién ganará cada punto. ¿Qué tipo de inferencia necesita?',
      type: 'select',
      points: 1,
      answers: [
        'Batch Transform',
        'Real-Time Inference',
        'Asynchronous Inference',
        'Serverless Inference con payloads de 1 GB',
      ],
      correctAnswer: 1,
      explanation:
        'La inferencia en tiempo real mantiene un endpoint siempre activo con latencia de milisegundos a segundos, payload de hasta 6 MB y procesamiento máximo de 60 segundos.',
    },
    {
      id: 'd3-11',
      title: 'Una aplicación recibe tráfico esporádico, con largos periodos de inactividad, y tolera algo de latencia inicial. ¿Qué opción de despliegue es la más económica?',
      type: 'select',
      points: 1,
      answers: [
        'Batch Transform programado cada hora',
        'Serverless Inference',
        'Entrenar un modelo nuevo para cada petición',
        'Real-Time Inference con un endpoint siempre activo',
      ],
      correctAnswer: 1,
      explanation:
        'Serverless Inference escala a cero y solo se paga por el procesamiento real, a costa de posibles cold starts.',
    },
    {
      id: 'd3-12',
      title: 'Una empresa procesa datasets de menos de 1 GB para reuniones semanales y no necesita respuestas inmediatas. ¿Qué tipo de inferencia encaja?',
      type: 'select',
      points: 1,
      answers: [
        'Asynchronous Inference',
        'Edge inference',
        'Serverless Inference',
        'Real-Time Inference',
      ],
      correctAnswer: 0,
      explanation:
        'La inferencia asíncrona admite payloads de hasta 1 GB y hasta 1 hora de procesamiento, con latencia «near real-time». Real-time y serverless se limitan a 6 MB.',
    },
    {
      id: 'd3-13',
      title: 'Se necesita generar predicciones sobre todo el catálogo de productos cada noche. ¿Qué opción es la adecuada?',
      type: 'select',
      points: 1,
      answers: [
        'Asynchronous Inference con un solo registro',
        'Serverless Inference',
        'Real-Time Inference',
        'Batch Transform',
      ],
      correctAnswer: 3,
      explanation:
        'Batch Transform procesa datasets completos de forma concurrente, con hasta 100 MB por mini-batch y latencia alta (minutos a horas).',
    },
    {
      id: 'd3-14',
      title: '¿Qué hace la cuantización (quantization) de un modelo?',
      type: 'select',
      points: 1,
      answers: [
        'Aumenta el número de capas de la red',
        'Elimina el modelo base y lo sustituye por reglas',
        'Reentrena el modelo con más epochs',
        'Reduce la precisión numérica de sus parámetros para disminuir tamaño, memoria y latencia',
      ],
      correctAnswer: 3,
      explanation:
        'Pasar de 32 bits a 8 o 4 bits acelera la inferencia con una pérdida mínima de calidad. Es una técnica de compresión junto con pruning y knowledge distillation.',
    },
    {
      id: 'd3-15',
      title: 'En la destilación de conocimiento (knowledge distillation), ¿qué ocurre?',
      type: 'select',
      points: 1,
      answers: [
        'Un modelo grande (teacher) entrena a otro más pequeño (student) para imitar sus predicciones',
        'Se traduce el modelo a otro idioma',
        'Se elimina el modelo grande tras entrenar uno pequeño desde cero',
        'Se reduce el tamaño de los datos de entrada',
      ],
      correctAnswer: 0,
      explanation:
        'El resultado es un modelo compacto, rápido y eficiente que se acerca al rendimiento del original. Es la base de muchos Small Language Models.',
    },
    {
      id: 'd3-16',
      title: 'Una aplicación debe funcionar sin conexión en dispositivos móviles con baja latencia. ¿Qué tipo de modelo es el más adecuado?',
      type: 'select',
      points: 1,
      answers: [
        'Un LLM de miles de millones de parámetros alojado en la nube',
        'Un Small Language Model (SLM) ejecutado en el edge',
        'Un modelo de difusión en un clúster de GPUs',
        'Un modelo no entrenado',
      ],
      correctAnswer: 1,
      explanation:
        'Los SLMs son versiones destiladas o comprimidas, indicados cuando hay restricciones de latencia, offline o privacidad que impiden enviar datos a la nube.',
    },
    {
      id: 'd3-17',
      title: '¿Qué es Amazon SageMaker Data Wrangler?',
      type: 'select',
      points: 1,
      answers: [
        'Un repositorio de modelos versionados',
        'Un servicio de inferencia en tiempo real',
        'Una herramienta visual para explorar, limpiar y transformar datos y crear features para ML',
        'Un algoritmo de clustering',
      ],
      correctAnswer: 2,
      explanation:
        'Data Wrangler importa datos de S3, Athena, Redshift o bases SQL y exporta flujos a Feature Store, a un notebook o a S3. También permite equilibrar datasets para corregir sesgos.',
    },
    {
      id: 'd3-18',
      title: '¿Qué aporta SageMaker Feature Store?',
      type: 'select',
      points: 1,
      answers: [
        'Una interfaz no-code para usuarios de negocio',
        'Monitorización de drift de modelos en producción',
        'Un hub de modelos preentrenados',
        'Un repositorio centralizado para almacenar y reutilizar features, con consistencia entre entrenamiento e inferencia',
      ],
      correctAnswer: 3,
      explanation:
        'Evita duplicar esfuerzos entre equipos y elimina el training-serving skew al usar las mismas features en entrenamiento e inferencia.',
    },
    {
      id: 'd3-19',
      title: '¿Qué hace SageMaker Automatic Model Tuning?',
      type: 'select',
      points: 1,
      answers: [
        'Etiqueta datos mediante trabajadores humanos',
        'Versiona y aprueba modelos para su despliegue',
        'Busca automáticamente los mejores hiperparámetros para optimizar una métrica objetivo',
        'Documenta riesgos y uso previsto de un modelo',
      ],
      correctAnswer: 2,
      explanation:
        'También llamado Hyperparameter Optimization (HPO): define la métrica objetivo y AMT elige rangos, estrategia de búsqueda y condiciones de parada temprana.',
    },
    {
      id: 'd3-20',
      title: 'Una empresa sin data scientists quiere crear modelos de ML sin escribir código. ¿Qué servicio recomiendas?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon SageMaker Canvas',
        'SageMaker Pipelines',
        'SageMaker Model Monitor',
        'AWS Trainium',
      ],
      correctAnswer: 0,
      explanation:
        'Canvas es la interfaz visual no-code de SageMaker, con AutoML (SageMaker Autopilot), acceso a modelos de Bedrock y a servicios como Rekognition, Comprehend y Textract.',
    },
    {
      id: 'd3-21',
      title: 'Se quiere predecir el tiempo meteorológico empezando con modelos ya existentes y personalizarlos después. ¿Qué servicio es el indicado?',
      type: 'select',
      points: 1,
      answers: [
        'SageMaker JumpStart',
        'SageMaker Ground Truth',
        'Amazon Forecast',
        'SageMaker Model Cards',
      ],
      correctAnswer: 0,
      explanation:
        'JumpStart es el hub de modelos fundacionales y soluciones preconstruidas que se pueden personalizar con datos propios y desplegar en SageMaker.',
    },
    {
      id: 'd3-22',
      title: '¿Qué servicio de SageMaker supervisa de forma continua la calidad de los modelos en producción y avisa del drift?',
      type: 'select',
      points: 1,
      answers: [
        'SageMaker Model Monitor',
        'SageMaker Studio',
        'SageMaker Model Registry',
        'SageMaker Role Manager',
      ],
      correctAnswer: 0,
      explanation:
        'Model Monitor detecta degradación del rendimiento y data drift; por ejemplo, un modelo de préstamos que empieza a aprobar créditos a perfiles inadecuados.',
    },
    {
      id: 'd3-23',
      title: '¿Para qué sirve SageMaker Pipelines?',
      type: 'select',
      points: 1,
      answers: [
        'Para etiquetar imágenes con trabajadores humanos',
        'Para detectar sesgos estadísticos en un dataset',
        'Para automatizar el flujo de ML (CI/CD): procesamiento, entrenamiento, tuning, registro y despliegue',
        'Para guardar las features de entrenamiento',
      ],
      correctAnswer: 2,
      explanation:
        'Un pipeline se compone de steps (Processing, Training, Tuning, AutoML, Model, ClarifyCheck, QualityCheck) y permite desplegar cientos de modelos de forma repetible.',
    },
    {
      id: 'd3-24',
      title: '¿Qué técnicas pertenecen a la familia PEFT (Parameter-Efficient Fine-Tuning)?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Full fine-tuning',
        'Prefix Tuning',
        'Adapter Layers',
        'Entrenamiento desde cero',
        'LoRA',
      ],
      correctAnswer: [1, 2, 4],
      explanation:
        'PEFT adapta modelos grandes actualizando solo un pequeño subconjunto de parámetros, reduciendo coste y complejidad sin sacrificar calidad.',
    },
    {
      id: 'd3-25',
      title: '¿Qué técnicas ayudan a optimizar la inferencia?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Cuantización',
        'Aumentar la precisión numérica de los pesos',
        'Destilación de conocimiento',
        'Aumentar el número de epochs de entrenamiento',
        'Pruning (poda de conexiones poco importantes)',
      ],
      correctAnswer: [0, 2, 4],
      explanation:
        'La compresión de modelos y la destilación reducen tamaño y latencia; usar instancias Inferentia reduce además el coste por inferencia.',
    },
    {
      id: 'd3-26',
      title: '¿Qué características comparten la inferencia Real-Time y la Serverless de SageMaker?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Escalado a cero cuando no hay tráfico en ambas',
        'Tiempo máximo de procesamiento de 60 segundos',
        'Payload máximo de 6 MB',
        'Payload de hasta 1 GB',
        'Latencia baja',
      ],
      correctAnswer: [1, 2, 4],
      explanation:
        'La diferencia es que Serverless escala a cero y puede sufrir cold starts, mientras que el endpoint real-time está siempre activo.',
    },
    {
      id: 'd3-27',
      title: '¿Qué herramientas de SageMaker apoyan el ciclo de vida y la gobernanza de los modelos?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Amazon Rekognition',
        'Model Registry',
        'Model Monitor',
        'Pipelines',
        'Amazon Polly',
      ],
      correctAnswer: [1, 2, 3],
      explanation:
        'Model Registry versiona y aprueba modelos; Pipelines automatiza el flujo; Model Monitor vigila la calidad en producción. Polly y Rekognition son servicios de IA.',
    },
    {
      id: 'd3-28',
      title: 'Relaciona cada tipo de inferencia con su caso de uso',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'Real-Time', right: 'Predicciones de baja latencia como detección de fraude o chatbots' },
        { left: 'Serverless', right: 'Tráfico esporádico que tolera cold starts y escala a cero' },
        { left: 'Asynchronous', right: 'Payloads grandes (hasta 1 GB) con procesamiento largo' },
        { left: 'Batch Transform', right: 'Scoring masivo de datasets completos' },
      ],
      explanation:
        'Es un tema muy preguntado: baja latencia, tráfico irregular, payloads grandes o procesamiento masivo.',
    },
    {
      id: 'd3-29',
      title: 'Relaciona cada herramienta de SageMaker con su función',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'Data Wrangler', right: 'Preparar y transformar datos tabulares e imágenes' },
        { left: 'Feature Store', right: 'Repositorio centralizado de features reutilizables' },
        { left: 'Ground Truth', right: 'Etiquetado de datos y feedback humano para RLHF' },
        { left: 'Canvas', right: 'Construir modelos de ML sin escribir código' },
      ],
      explanation:
        'SageMaker Studio integra todas estas herramientas en un único IDE para el ciclo de vida completo del ML.',
    },
    {
      id: 'd3-30',
      title: 'Relaciona cada técnica de adaptación de un Foundation Model con su descripción',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'Full fine-tuning', right: 'Actualiza todos los parámetros del modelo' },
        { left: 'LoRA', right: 'Entrena matrices de baja dimensión y congela los pesos originales' },
        { left: 'Instruction tuning', right: 'Usa pares instrucción-respuesta para mejorar el seguimiento de instrucciones' },
        { left: 'RLHF', right: 'Entrena un modelo de recompensa con valoraciones humanas para alinear al modelo' },
      ],
      explanation:
        'Cada técnica ofrece un equilibrio distinto entre coste, calidad y riesgo de olvidar conocimiento previo.',
    },
    {
      id: 'd3-31',
      title: 'Clasifica cada elemento según corresponda a entrenamiento o a inferencia',
      type: 'classify',
      points: 4,
      categories: ['Entrenamiento', 'Inferencia'],
      classifyItems: [
        { text: 'AWS Inferentia (instancias Inf1)', category: 'Inferencia' },
        { text: 'AWS Trainium (instancias Trn1)', category: 'Entrenamiento' },
        { text: 'Epochs y batch size', category: 'Entrenamiento' },
        { text: 'Cuantización del modelo', category: 'Inferencia' },
        { text: 'Batch Transform', category: 'Inferencia' },
        { text: 'SageMaker Automatic Model Tuning', category: 'Entrenamiento' },
      ],
      explanation:
        'El entrenamiento es un evento puntual y costoso; la inferencia es continua y su coste acumulado suele ser mayor, por lo que se optimiza con cuantización, destilación o Inferentia.',
    },
    {
      id: 'd3-32',
      title: 'Clasifica cada herramienta de SageMaker según la fase del ciclo de vida en que interviene',
      type: 'classify',
      points: 4,
      categories: ['Preparar datos', 'Construir y entrenar', 'Desplegar y monitorizar'],
      classifyItems: [
        { text: 'Model Monitor', category: 'Desplegar y monitorizar' },
        { text: 'Automatic Model Tuning', category: 'Construir y entrenar' },
        { text: 'Feature Store', category: 'Preparar datos' },
        { text: 'Data Wrangler', category: 'Preparar datos' },
        { text: 'Model Registry', category: 'Desplegar y monitorizar' },
        { text: 'Built-in Algorithms', category: 'Construir y entrenar' },
      ],
      explanation:
        'SageMaker cubre tres fases: recopilar y preparar datos, construir y entrenar modelos, y desplegarlos y monitorizar sus predicciones.',
    },
    {
      id: 'd3-33',
      title: 'Clasifica cada tipo de inferencia según su límite de payload',
      type: 'classify',
      points: 4,
      categories: ['6 MB', '100 MB por mini-batch', '1 GB'],
      classifyItems: [
        { text: 'Asynchronous Inference', category: '1 GB' },
        { text: 'Serverless Inference', category: '6 MB' },
        { text: 'Batch Transform', category: '100 MB por mini-batch' },
        { text: 'Real-Time Inference', category: '6 MB' },
      ],
      explanation:
        'Real-time y serverless admiten un registro de hasta 6 MB y 60 segundos; asíncrona, hasta 1 GB y 1 hora; batch, hasta 100 MB por mini-batch.',
    },
  ],
};

export const testDominio4: TestConfig = {
  id: 'aif-d4',
  title: 'Dominio 4 · IA responsable',
  numberOfQuestions: 15,
  time: 20,
  pointsType: 'over10',
  minForPass: 6,
  onTimeUp: 'warn',
  questions: [
    {
      id: 'd4-1',
      title: '¿Qué es la IA responsable?',
      type: 'select',
      points: 1,
      answers: [
        'Una certificación obligatoria de AWS para usar Bedrock',
        'Un sinónimo de seguridad informática',
        'El conjunto de prácticas que aseguran sistemas de IA transparentes y confiables, mitigando riesgos durante todo su ciclo de vida',
        'Un tipo de modelo que nunca comete errores',
      ],
      correctAnswer: 2,
      explanation:
        'Responsible AI cubre diseño, desarrollo, despliegue, monitorización y evaluación. Es distinta de la seguridad, que protege confidencialidad, integridad y disponibilidad de los datos y la infraestructura.',
    },
    {
      id: 'd4-2',
      title: 'Un modelo de aprobación de créditos penaliza sistemáticamente a un grupo demográfico. ¿Qué dimensión de la IA responsable se ve comprometida?',
      type: 'select',
      points: 1,
      answers: [
        'Veracity and robustness',
        'Governance',
        'Controllability',
        'Fairness (equidad)',
      ],
      correctAnswer: 3,
      explanation:
        'Un modelo justo no debe producir resultados sistemáticamente distintos para grupos demográficos distintos cuando esa diferencia no está justificada.',
    },
    {
      id: 'd4-3',
      title: '¿En qué se diferencian interpretabilidad y explicabilidad?',
      type: 'select',
      points: 1,
      answers: [
        'La explicabilidad exige acceso al código fuente y la interpretabilidad no',
        'La interpretabilidad permite entender la causa de la decisión mirando dentro del modelo; la explicabilidad describe su comportamiento observando entradas y salidas',
        'Son exactamente lo mismo',
        'La interpretabilidad solo aplica a modelos generativos',
      ],
      correctAnswer: 1,
      explanation:
        'A menudo la explicabilidad es suficiente cuando la interpretabilidad completa no es viable, como en las redes neuronales profundas.',
    },
    {
      id: 'd4-4',
      title: '¿Qué compromiso existe entre interpretabilidad y rendimiento?',
      type: 'select',
      points: 1,
      answers: [
        'No existe ninguna relación entre ambos',
        'Los modelos más transparentes (como los árboles de decisión) suelen rendir peor que los modelos complejos tipo caja negra',
        'Los modelos más interpretables siempre rinden mejor',
        'Los modelos complejos son siempre más interpretables',
      ],
      correctAnswer: 1,
      explanation:
        'Alta transparencia implica alta interpretabilidad pero frecuentemente menor rendimiento; las redes neuronales profundas rinden más pero son «black box».',
    },
    {
      id: 'd4-5',
      title: '¿Qué muestra un Partial Dependence Plot (PDP)?',
      type: 'select',
      points: 1,
      answers: [
        'La evolución de la función de pérdida por epoch',
        'Cómo influye una única feature en el resultado predicho manteniendo constantes las demás',
        'El coste de inferencia por petición',
        'La matriz de confusión del modelo',
      ],
      correctAnswer: 1,
      explanation:
        'Los PDP son útiles con modelos black box y pueden revelar relaciones inesperadas que sugieren sesgo o errores en los datos. SageMaker Clarify puede generarlos.',
    },
    {
      id: 'd4-6',
      title: '¿Qué herramienta de AWS evalúa modelos en términos de sesgo y explicabilidad?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon Polly',
        'Amazon SageMaker Clarify',
        'Amazon SageMaker Canvas',
        'AWS Trusted Advisor',
      ],
      correctAnswer: 1,
      explanation:
        'Clarify detecta sesgo en datos y modelos, explica predicciones y evalúa Foundation Models en precisión, robustez y toxicidad.',
    },
    {
      id: 'd4-7',
      title: 'Un modelo de riesgo de préstamos señala sistemáticamente a personas de grupos étnicos concretos. ¿Qué causa es la más probable y cómo se corrige?',
      type: 'select',
      points: 1,
      answers: [
        'Un learning rate demasiado bajo; se sube el valor',
        'Sampling bias en los datos de entrenamiento; se equilibran los datos (por ejemplo con data augmentation) y se reentrena',
        'Underfitting; se reduce el número de epochs',
        'Prompt injection; se añaden más guardrails',
      ],
      correctAnswer: 1,
      explanation:
        'Los datos no representan de forma justa a toda la población. Se mitiga con datos diversos y representativos, detectando el sesgo con Clarify y monitorizando después con Model Monitor.',
    },
    {
      id: 'd4-8',
      title: '¿Puede SageMaker Clarify detectar el Observer Bias o el Confirmation Bias?',
      type: 'select',
      points: 1,
      answers: [
        'Sí, automáticamente en cualquier dataset',
        'No: son sesgos cognitivos del juicio humano, no patrones estadísticos en datos o modelos',
        'Sí, pero únicamente con la edición Enterprise',
        'Sí, pero solo en modelos generativos',
      ],
      correctAnswer: 1,
      explanation:
        'Clarify detecta sesgos estadísticos como Class Imbalance, Sampling Bias, Disparate Impact o Demographic Parity.',
    },
    {
      id: 'd4-9',
      title: '¿Qué servicio permite filtrar contenido dañino, bloquear temas y redactar información personal en las entradas y salidas de un modelo de Bedrock?',
      type: 'select',
      points: 1,
      answers: [
        'AWS WAF',
        'Guardrails for Amazon Bedrock',
        'SageMaker Model Monitor',
        'Amazon Macie',
      ],
      correctAnswer: 1,
      explanation:
        'Guardrails es la primera línea de defensa para controlar el comportamiento de los Foundation Models en Bedrock.',
    },
    {
      id: 'd4-10',
      title: '¿Qué servicio incorpora revisión humana de predicciones de ML con baja confianza antes de ejecutar la decisión?',
      type: 'select',
      points: 1,
      answers: [
        'AWS Config',
        'Amazon Lex',
        'Amazon Augmented AI (A2I)',
        'Amazon Textract',
      ],
      correctAnswer: 2,
      explanation:
        'A2I es la pieza «human-in-the-loop» de la IA responsable: un humano revisa y valida las decisiones del modelo en escenarios críticos.',
    },
    {
      id: 'd4-11',
      title: '¿Dónde se documentan las prácticas de IA responsable que AWS ha aplicado a sus propios servicios, como Textract o Rekognition?',
      type: 'select',
      points: 1,
      answers: [
        'En las SageMaker Model Cards del cliente',
        'En el Cost and Usage Report',
        'En AWS CloudTrail',
        'En las AWS AI Service Cards',
      ],
      correctAnswer: 3,
      explanation:
        'Las AI Service Cards son documentación de AWS sobre sus servicios (usos previstos, limitaciones, diseño responsable). Las Model Cards las crea el cliente para sus propios modelos.',
    },
    {
      id: 'd4-12',
      title: '¿Qué información suele incluir una Model Card?',
      type: 'select',
      points: 1,
      answers: [
        'El código fuente completo del modelo',
        'Únicamente el precio de la inferencia',
        'La lista de empleados que lo entrenaron',
        'Uso previsto, risk rating, detalles del entrenamiento y métricas de rendimiento',
      ],
      correctAnswer: 3,
      explanation:
        'SageMaker Model Cards centraliza la documentación de los modelos y ayuda en las auditorías; en IA generativa puede citar fuentes y origen de los datos.',
    },
    {
      id: 'd4-13',
      title: '¿Cuál es la causa técnica de las alucinaciones de los LLM?',
      type: 'select',
      points: 1,
      answers: [
        'Un error de red al llamar a la API',
        'La falta de memoria RAM de la instancia',
        'El uso de embeddings',
        'El muestreo probabilístico de la siguiente palabra: el texto es estadísticamente plausible pero puede ser falso',
      ],
      correctAnswer: 3,
      explanation:
        'Las alucinaciones pueden mitigarse, pero no eliminarse del todo. Conviene educar a los usuarios, contrastar con fuentes independientes y marcar el contenido como no verificado.',
    },
    {
      id: 'd4-14',
      title: '¿Cómo se mitiga la toxicidad de un modelo generativo?',
      type: 'select',
      points: 1,
      answers: [
        'Curando los datos de entrenamiento y usando modelos guardrail que detecten y filtren el contenido no deseado',
        'Eliminando el prompt del usuario',
        'Aumentando la temperature',
        'Usando un modelo más grande sin ningún filtro',
      ],
      correctAnswer: 0,
      explanation:
        'Definir qué es tóxico es difícil porque existe una línea difusa entre restringir contenido y censurar, por ejemplo con citas textuales.',
    },
    {
      id: 'd4-15',
      title: 'Un atacante introduce deliberadamente datos sesgados o maliciosos en el dataset de entrenamiento. ¿Cómo se llama este ataque?',
      type: 'select',
      points: 1,
      answers: [
        'Hijacking',
        'Jailbreaking',
        'Poisoning (envenenamiento)',
        'Prompt leaking',
      ],
      correctAnswer: 2,
      explanation:
        'El poisoning ataca la cadena de suministro de datos del modelo y le lleva a producir salidas sesgadas, ofensivas o dañinas.',
    },
    {
      id: 'd4-16',
      title: 'Un usuario incrusta instrucciones dentro de un prompt para secuestrar el comportamiento del modelo. ¿Qué ataque es?',
      type: 'select',
      points: 1,
      answers: [
        'Poisoning',
        'Exposure',
        'Overfitting',
        'Prompt injection o hijacking',
      ],
      correctAnswer: 3,
      explanation:
        'La inyección de prompts alinea las salidas del modelo con las intenciones del atacante, por ejemplo desinformación o ejecución de código malicioso. Se mitiga con guardrails, filtrado y validación de entradas.',
    },
    {
      id: 'd4-17',
      title: 'Un usuario consigue con prompts cuidadosamente diseñados que el modelo ignore sus restricciones éticas y de seguridad. ¿Cómo se llama?',
      type: 'select',
      points: 1,
      answers: [
        'Jailbreaking',
        'Data augmentation',
        'Prompt leaking',
        'Poisoning',
      ],
      correctAnswer: 0,
      explanation:
        'El jailbreaking intenta eludir las restricciones con las que se entrena el modelo; un ejemplo documentado es el many-shot jailbreaking.',
    },
    {
      id: 'd4-18',
      title: '¿Qué significa «regulated workload»?',
      type: 'select',
      points: 1,
      answers: [
        'Una carga que usa únicamente Spot Instances',
        'Una carga que no almacena datos',
        'Una carga de trabajo sujeta a marcos regulatorios que exigen auditoría, archivado o requisitos de seguridad especiales',
        'Una carga que se ejecuta solo en una Region regulada por AWS',
      ],
      correctAnswer: 2,
      explanation:
        'Sectores como servicios financieros, sanidad o aeroespacial exigen cumplimiento adicional, con implicaciones directas en arquitectura, gobernanza y herramientas.',
    },
    {
      id: 'd4-19',
      title: '¿Cómo clasifica el EU Artificial Intelligence Act los sistemas de IA?',
      type: 'select',
      points: 1,
      answers: [
        'Según el idioma en el que operan',
        'Según el proveedor de nube utilizado',
        'Según su nivel de riesgo, con requisitos más estrictos para los sistemas de alto riesgo',
        'Según el número de parámetros del modelo',
      ],
      correctAnswer: 2,
      explanation:
        'Los sistemas de alto riesgo, como selección de personal, créditos bancarios o justicia, están sujetos a los requisitos más estrictos.',
    },
    {
      id: 'd4-20',
      title: '¿Cuál de los siguientes es un principio del diseño centrado en el humano (HCD) para IA explicable?',
      type: 'select',
      points: 1,
      answers: [
        'Ocultar el razonamiento del modelo al usuario',
        'Sustituir al decisor humano en entornos de alta presión',
        'Diseñar solo para usuarios técnicos',
        'Cognitive apprenticeship: la IA aprende de instructores y expertos humanos',
      ],
      correctAnswer: 3,
      explanation:
        'HCD incluye decisiones amplificadas, claridad, reflexividad, decisiones sin sesgo y aprendizaje humano y de la IA (cognitive apprenticeship, personalización y user-centered design).',
    },
    {
      id: 'd4-21',
      title: '¿Cuáles son dimensiones de la IA responsable?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Scalability',
        'Transparency',
        'Fairness',
        'Elasticity',
        'Controllability',
      ],
      correctAnswer: [1, 2, 4],
      explanation:
        'Las ocho dimensiones son fairness, explainability, privacy and security, transparency, veracity and robustness, governance, safety y controllability.',
    },
    {
      id: 'd4-22',
      title: '¿Qué medidas ayudan a mitigar las alucinaciones?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Educar a los usuarios para que verifiquen el contenido generado',
        'Desactivar los guardrails',
        'Contrastar las respuestas con fuentes independientes',
        'Marcar el contenido generado como no verificado',
        'Subir la temperature al máximo',
      ],
      correctAnswer: [0, 2, 3],
      explanation:
        'Subir la temperature aumenta la aleatoriedad y desactivar guardrails elimina una capa de control.',
    },
    {
      id: 'd4-23',
      title: '¿Cuáles son retos de cumplimiento específicos de la IA?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Dinamismo y adaptabilidad: los sistemas cambian con el tiempo',
        'Los sistemas de IA son estáticos y fáciles de auditar',
        'Capacidades emergentes no previstas',
        'Los modelos nunca cambian tras el despliegue',
        'Complejidad y opacidad de los sistemas',
      ],
      correctAnswer: [0, 2, 4],
      explanation:
        'A diferencia del software tradicional, la IA es opaca, dinámica y puede desarrollar capacidades no previstas, además de riesgos únicos como el sesgo algorítmico.',
    },
    {
      id: 'd4-24',
      title: '¿Qué tipos de sesgo SÍ puede detectar SageMaker Clarify?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Disparate Impact',
        'Sampling Bias',
        'Observer Bias',
        'Confirmation Bias',
        'Class Imbalance',
      ],
      correctAnswer: [0, 1, 4],
      explanation:
        'Clarify detecta sesgos estadísticos antes del entrenamiento (datos) y después (modelo). Los sesgos cognitivos humanos quedan fuera de su alcance.',
    },
    {
      id: 'd4-25',
      title: 'Relaciona cada ataque con su descripción',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'Poisoning', right: 'Introducir datos maliciosos o sesgados en el dataset de entrenamiento' },
        { left: 'Hijacking / Prompt injection', right: 'Incrustar instrucciones en el prompt para secuestrar el comportamiento del modelo' },
        { left: 'Prompt leaking', right: 'Divulgación no intencionada de los prompts o entradas usados por el modelo' },
        { left: 'Jailbreaking', right: 'Eludir las restricciones éticas y de seguridad del modelo' },
      ],
      explanation:
        'Existe un quinto uso malicioso, la exposure: revelar datos sensibles al modelo, que luego podría reproducirlos.',
    },
    {
      id: 'd4-26',
      title: 'Relaciona cada herramienta con su función en la IA responsable',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'Guardrails for Amazon Bedrock', right: 'Filtrar contenido, temas y datos personales en entradas y salidas' },
        { left: 'SageMaker Clarify', right: 'Detectar sesgo y explicar predicciones' },
        { left: 'SageMaker Model Cards', right: 'Documentar el uso previsto, el riesgo y las métricas del modelo' },
        { left: 'Amazon Augmented AI (A2I)', right: 'Añadir revisión humana a las predicciones' },
      ],
      explanation:
        'AWS ofrece herramientas para cada etapa del ciclo de vida: control de salidas, evaluación, documentación y supervisión humana.',
    },
    {
      id: 'd4-27',
      title: 'Relaciona cada dimensión de la IA responsable con su pregunta clave',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'Fairness', right: '¿El modelo trata a todos los grupos de forma equitativa?' },
        { left: 'Explainability', right: '¿Podemos explicar por qué el modelo tomó esta decisión?' },
        { left: 'Governance', right: '¿Hay políticas y procesos claros para supervisar el sistema?' },
        { left: 'Controllability', right: '¿Pueden los humanos intervenir y corregir el sistema?' },
      ],
      explanation:
        'Un modelo puede ser seguro pero injusto o justo pero vulnerable: las dimensiones deben abordarse en paralelo.',
    },
    {
      id: 'd4-28',
      title: 'Clasifica cada tipo de sesgo según se origine antes del entrenamiento (datos) o después (modelo)',
      type: 'classify',
      points: 4,
      categories: ['Pre-training bias (datos)', 'Post-training bias (modelo)'],
      classifyItems: [
        { text: 'Sampling Bias', category: 'Pre-training bias (datos)' },
        { text: 'Label Bias', category: 'Pre-training bias (datos)' },
        { text: 'Demographic Parity', category: 'Post-training bias (modelo)' },
        { text: 'Disparate Impact', category: 'Post-training bias (modelo)' },
        { text: 'Class Imbalance', category: 'Pre-training bias (datos)' },
        { text: 'Equalized Odds', category: 'Post-training bias (modelo)' },
      ],
      explanation:
        'SageMaker Clarify analiza ambos momentos: sesgos en los datos antes del entrenamiento y sesgos en las predicciones del modelo después.',
    },
    {
      id: 'd4-29',
      title: 'Clasifica cada medida según el riesgo que mitiga',
      type: 'classify',
      points: 4,
      categories: ['Alucinaciones', 'Toxicidad'],
      classifyItems: [
        { text: 'Curar los datos de entrenamiento eliminando frases ofensivas', category: 'Toxicidad' },
        { text: 'Usar guardrail models para filtrar contenido no deseado', category: 'Toxicidad' },
        { text: 'Marcar el contenido generado como no verificado', category: 'Alucinaciones' },
        { text: 'Educar a los usuarios para que verifiquen lo generado', category: 'Alucinaciones' },
        { text: 'Contrastar las respuestas con fuentes independientes', category: 'Alucinaciones' },
        { text: 'Definir con cuidado qué se considera tóxico para no caer en censura', category: 'Toxicidad' },
      ],
      explanation:
        'Las alucinaciones se mitigan con verificación y transparencia; la toxicidad, con datos curados y filtros de salida.',
    },
    {
      id: 'd4-30',
      title: 'Clasifica cada descripción según corresponda a las AWS AI Service Cards o a las SageMaker Model Cards',
      type: 'classify',
      points: 4,
      categories: ['AWS AI Service Cards', 'SageMaker Model Cards'],
      classifyItems: [
        { text: 'Apoya las auditorías internas de tus modelos', category: 'SageMaker Model Cards' },
        { text: 'Describe las decisiones de diseño responsable de un servicio de IA de AWS', category: 'AWS AI Service Cards' },
        { text: 'Centraliza risk rating y métricas de entrenamiento de tus modelos', category: 'SageMaker Model Cards' },
        { text: 'Documentación que crea tu equipo sobre sus propios modelos', category: 'SageMaker Model Cards' },
        { text: 'Ejemplo: la tarjeta de servicio de Amazon Rekognition', category: 'AWS AI Service Cards' },
        { text: 'Documentación de AWS sobre usos y limitaciones de Amazon Textract', category: 'AWS AI Service Cards' },
      ],
      explanation:
        'Las Service Cards las publica AWS para sus servicios; las Model Cards las rellena el cliente para sus modelos.',
    },
  ],
};

export const testDominio5: TestConfig = {
  id: 'aif-d5',
  title: 'Dominio 5 · Seguridad, cumplimiento y gobernanza',
  numberOfQuestions: 15,
  time: 20,
  pointsType: 'over10',
  minForPass: 6,
  onTimeUp: 'warn',
  questions: [
    {
      id: 'd5-1',
      title: 'Según el modelo de responsabilidad compartida, ¿qué es responsabilidad del cliente al usar Amazon Bedrock?',
      type: 'select',
      points: 1,
      answers: [
        'La seguridad física de los centros de datos',
        'Los datos que alimentan al modelo, los controles de acceso, la configuración de guardrails y el cifrado',
        'La seguridad del hipervisor',
        'El mantenimiento del hardware que ejecuta los modelos',
      ],
      correctAnswer: 1,
      explanation:
        'AWS protege la infraestructura de los servicios gestionados; el cliente protege lo que pone dentro: datos, accesos, guardrails y cifrado.',
    },
    {
      id: 'd5-2',
      title: 'Un cliente deja un bucket de S3 con datos de entrenamiento sin cifrar y con acceso público. ¿Quién es responsable?',
      type: 'select',
      points: 1,
      answers: [
        'AWS, porque el bucket está en su infraestructura',
        'El proveedor del modelo',
        'La responsabilidad se reparte al 50 %',
        'El cliente, porque la configuración de sus recursos es su responsabilidad',
      ],
      correctAnswer: 3,
      explanation:
        'La regla general: AWS protege la infraestructura y el cliente protege lo que despliega y configura sobre ella.',
    },
    {
      id: 'd5-3',
      title: '¿Qué servicio de AWS es el principal para crear y gestionar claves de cifrado?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon Inspector',
        'AWS Budgets',
        'AWS Shield',
        'AWS Key Management Service (KMS)',
      ],
      correctAnswer: 3,
      explanation:
        'Los datos deben cifrarse en reposo y en tránsito; las claves se gestionan con KMS y se protegen contra accesos no autorizados.',
    },
    {
      id: 'd5-4',
      title: '¿Desde dónde se descargan los informes de compliance y las certificaciones de AWS?',
      type: 'select',
      points: 1,
      answers: [
        'AWS Config',
        'AWS Trusted Advisor',
        'AWS Artifact',
        'Amazon CloudWatch',
      ],
      correctAnswer: 2,
      explanation:
        'AWS cuenta con más de 140 estándares y certificaciones (NIST, ISO, SOC, HIPAA, GDPR, PCI DSS...) y los informes se obtienen en Artifact.',
    },
    {
      id: 'd5-5',
      title: '¿Qué estándar o regulación protege los datos de salud en Estados Unidos?',
      type: 'select',
      points: 1,
      answers: [
        'HIPAA',
        'ISO',
        'GDPR',
        'PCI DSS',
      ],
      correctAnswer: 0,
      explanation:
        'HIPAA cubre datos sanitarios; PCI DSS, datos de tarjetas de pago; GDPR, la protección de datos en la Unión Europea.',
    },
    {
      id: 'd5-6',
      title: 'Una norma exige que los datos de ciudadanos europeos se procesen y almacenen dentro de la UE. ¿Qué concepto de gestión de datos se está aplicando?',
      type: 'select',
      points: 1,
      answers: [
        'Data retention',
        'Data augmentation',
        'Data lineage',
        'Data residency (residencia de datos)',
      ],
      correctAnswer: 3,
      explanation:
        'AWS permite elegir la Region donde se despliegan los servicios para cumplir con los requisitos de residencia de datos.',
    },
    {
      id: 'd5-7',
      title: '¿Quién debería formar parte de un AI Governance Board?',
      type: 'select',
      points: 1,
      answers: [
        'Únicamente los proveedores de la nube',
        'Solo el departamento de marketing',
        'Solo el equipo técnico de desarrollo',
        'Representantes de diversos departamentos: legal, cumplimiento, privacidad de datos y expertos en IA',
      ],
      correctAnswer: 3,
      explanation:
        'La diversidad de perspectivas permite identificar riesgos que un equipo puramente técnico podría pasar por alto.',
    },
    {
      id: 'd5-8',
      title: '¿Qué es MLOps?',
      type: 'select',
      points: 1,
      answers: [
        'La extensión de las prácticas de DevOps al ML para desplegar, monitorizar y reentrenar modelos de forma sistemática y repetible',
        'Una técnica de compresión de modelos',
        'Un tipo de aprendizaje no supervisado',
        'Un servicio de almacenamiento de objetos',
      ],
      correctAnswer: 0,
      explanation:
        'Sin MLOps los modelos tienden a degradarse en producción sin que nadie lo detecte. Sus principios incluyen control de versiones, automatización, CI/CD, reentrenamiento y monitorización continuos.',
    },
    {
      id: 'd5-9',
      title: '¿Qué hace el Network Isolation Mode de SageMaker?',
      type: 'select',
      points: 1,
      answers: [
        'Permite acceso público temporal a los datos',
        'Cifra automáticamente los datos de entrenamiento',
        'Replica el modelo en varias Regions',
        'Ejecuta los contenedores de trabajo sin acceso saliente a Internet, ni siquiera a Amazon S3',
      ],
      correctAnswer: 3,
      explanation:
        'Es una medida crítica cuando los datos son extremadamente sensibles y no deben salir del entorno de ejecución.',
    },
    {
      id: 'd5-10',
      title: '¿Cuál es la mejor defensa básica frente a la inyección de prompts?',
      type: 'select',
      points: 1,
      answers: [
        'Implementar guardrails con filtrado de prompts, sanitización y validación de las entradas',
        'Subir la temperature del modelo',
        'Aumentar el tamaño de la ventana de contexto',
        'Cambiar de Region',
      ],
      correctAnswer: 0,
      explanation:
        'La inyección de prompts manipula las entradas para generar contenido malicioso o no deseado; se mitiga controlando las entradas y salidas.',
    },
    {
      id: 'd5-11',
      title: '¿Qué principio de IAM se recomienda para el acceso a los datos de IA?',
      type: 'select',
      points: 1,
      answers: [
        'Conceder acceso público por defecto',
        'Compartir un único usuario entre todo el equipo',
        'Dar acceso de administrador a todos los usuarios',
        'El principio de mínimo privilegio',
      ],
      correctAnswer: 3,
      explanation:
        'Un marco de gobernanza de datos incluye RBAC, permisos granulares, SSO, MFA, registro de accesos y revisión periódica según el mínimo privilegio.',
    },
    {
      id: 'd5-12',
      title: '¿Cuál de las siguientes NO es una dimensión de la calidad de los datos?',
      type: 'select',
      points: 1,
      answers: [
        'Timeliness (oportunidad)',
        'Popularity (popularidad)',
        'Consistency (consistencia)',
        'Completeness (completitud)',
      ],
      correctAnswer: 1,
      explanation:
        'Las cuatro dimensiones son completeness, accuracy, timeliness y consistency. Se complementan con data profiling, monitoring y data lineage.',
    },
    {
      id: 'd5-13',
      title: '¿Qué tecnologías de mejora de la privacidad (PETs) ayudan a minimizar el riesgo de brechas de datos?',
      type: 'select',
      points: 1,
      answers: [
        'Desactivar los registros de auditoría',
        'Data masking, obfuscation, encryption y tokenization',
        'Aumentar el número de epochs',
        'Usar batch sizes más grandes',
      ],
      correctAnswer: 1,
      explanation:
        'Enmascarar, ofuscar, cifrar y tokenizar protege los datos durante su procesamiento y uso.',
    },
    {
      id: 'd5-14',
      title: '¿Para qué sirve la GenAI Security Scoping Matrix?',
      type: 'select',
      points: 1,
      answers: [
        'Para medir la precisión de un modelo',
        'Para clasificar las aplicaciones de IA generativa en cinco alcances y determinar el nivel de controles de seguridad necesario',
        'Para calcular el coste de las inferencias',
        'Para elegir el tamaño de una VPC',
      ],
      correctAnswer: 1,
      explanation:
        'Una aplicación que solo consume una API de terceros tiene requisitos de seguridad muy distintos a una que entrena modelos propios con datos propietarios.',
    },
    {
      id: 'd5-15',
      title: '¿Qué servicio de AWS ayuda a descubrir y proteger datos sensibles, como información personal, almacenados en S3?',
      type: 'select',
      points: 1,
      answers: [
        'AWS CloudFormation',
        'Amazon QuickSight',
        'Amazon Macie',
        'Amazon Polly',
      ],
      correctAnswer: 2,
      explanation:
        'Macie usa machine learning para descubrir datos sensibles en S3 y es una pieza útil para el cumplimiento normativo de los datos de entrenamiento.',
    },
    {
      id: 'd5-16',
      title: '¿Qué servicio registra las llamadas a la API realizadas sobre los recursos de IA, útil para auditorías de seguridad?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon Lex',
        'Amazon Forecast',
        'AWS Batch',
        'AWS CloudTrail',
      ],
      correctAnswer: 3,
      explanation:
        'CloudTrail registra quién hizo qué, cuándo y desde dónde. Bedrock se integra con IAM, CloudWatch y CloudTrail.',
    },
    {
      id: 'd5-17',
      title: '¿Qué herramienta de SageMaker define roles de acceso con permisos granulares para data scientists, ingenieros de MLOps y administradores?',
      type: 'select',
      points: 1,
      answers: [
        'SageMaker Ground Truth',
        'SageMaker JumpStart',
        'SageMaker Canvas',
        'SageMaker Role Manager',
      ],
      correctAnswer: 3,
      explanation:
        'Role Manager asegura que cada persona tenga acceso solo a las herramientas y datos que necesita para su trabajo.',
    },
    {
      id: 'd5-18',
      title: '¿Qué responsabilidades corresponden al cliente al usar Amazon Bedrock?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Configurar los guardrails',
        'Cifrar los datos de la aplicación',
        'Gestionar los controles de acceso a los datos',
        'El mantenimiento del hardware de los servidores',
        'La seguridad física de los centros de datos',
      ],
      correctAnswer: [0, 1, 2],
      explanation:
        'La seguridad física, el hardware, el hipervisor y la red subyacente son responsabilidad de AWS.',
    },
    {
      id: 'd5-19',
      title: '¿Qué principios forman parte de MLOps?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Evitar monitorizar el modelo en producción',
        'Desplegar los modelos manualmente una sola vez',
        'Automatización de las etapas del pipeline',
        'Control de versiones de datos, código y modelos',
        'Reentrenamiento continuo cuando se degrada el rendimiento',
      ],
      correctAnswer: [2, 3, 4],
      explanation:
        'MLOps cierra el ciclo entre desarrollo y operación: un pipeline automatizado que permite iterar con confianza, no desplegar un modelo una sola vez.',
    },
    {
      id: 'd5-20',
      title: '¿Cuáles son dimensiones de la calidad de los datos?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Completeness',
        'Popularity',
        'Consistency',
        'Timeliness',
        'Compression',
      ],
      correctAnswer: [0, 2, 3],
      explanation:
        'Además de accuracy, estas dimensiones aseguran que los datos sean un cimiento fiable para sistemas de IA.',
    },
    {
      id: 'd5-21',
      title: '¿Qué controles son compartidos entre AWS y el cliente?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Gestión de configuración',
        'Formación y concienciación',
        'Seguridad física de las instalaciones',
        'Destrucción segura del hardware',
        'Gestión de parches',
      ],
      correctAnswer: [0, 1, 4],
      explanation:
        'AWS gestiona los parches de la infraestructura y el cliente los de sus sistemas; lo mismo ocurre con la configuración y la formación de las personas.',
    },
    {
      id: 'd5-22',
      title: 'Relaciona cada estándar con su ámbito',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'HIPAA', right: 'Datos sanitarios' },
        { left: 'GDPR', right: 'Protección de datos en la Unión Europea' },
        { left: 'PCI DSS', right: 'Datos de tarjetas de pago' },
        { left: 'SOC', right: 'Controles de sistemas y organización de AWS' },
      ],
      explanation:
        'AWS aporta más de 140 estándares y certificaciones; el cliente debe comprobar cuáles aplican a su carga de trabajo.',
    },
    {
      id: 'd5-23',
      title: 'Relaciona cada práctica de seguridad de sistemas de IA con su descripción',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'Threat detection', right: 'Sistemas basados en IA que analizan tráfico y comportamiento de usuarios' },
        { left: 'Vulnerability management', right: 'Evaluaciones de seguridad, pruebas de penetración y gestión de parches' },
        { left: 'Infrastructure protection', right: 'Control de acceso, segmentación de red y cifrado' },
        { left: 'Prompt injection defense', right: 'Filtrado, sanitización y validación de entradas' },
      ],
      explanation:
        'Los sistemas de IA pueden ser a la vez objetivo y herramienta de las amenazas.',
    },
    {
      id: 'd5-24',
      title: 'Relaciona cada concepto de gestión de datos con su descripción',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'Data lifecycle', right: 'Fases de los datos: recolección, procesamiento, almacenamiento, consumo y archivado' },
        { left: 'Data logging', right: 'Registro de entradas, salidas, métricas de rendimiento y eventos del sistema' },
        { left: 'Data residency', right: 'Dónde se procesan y almacenan los datos' },
        { left: 'Data retention', right: 'Requisitos regulatorios, datos históricos de entrenamiento y coste de almacenamiento' },
      ],
      explanation:
        'Una buena gestión de datos es la base de cualquier sistema de IA fiable y cumplidor.',
    },
    {
      id: 'd5-25',
      title: 'Clasifica cada tarea según sea responsabilidad de AWS o del cliente en un servicio gestionado de IA',
      type: 'classify',
      points: 4,
      categories: ['AWS', 'Cliente'],
      classifyItems: [
        { text: 'Hardware y redes que ejecutan los servicios', category: 'AWS' },
        { text: 'Cifrado de los datos de la aplicación', category: 'Cliente' },
        { text: 'Seguridad de la infraestructura que ejecuta Amazon Bedrock', category: 'AWS' },
        { text: 'Gestión de permisos con IAM', category: 'Cliente' },
        { text: 'Configuración de guardrails', category: 'Cliente' },
        { text: 'Instalaciones físicas de las Regions y AZs', category: 'AWS' },
      ],
      explanation:
        'AWS es responsable de la «seguridad DE la nube»; el cliente, de la «seguridad EN la nube».',
    },
    {
      id: 'd5-26',
      title: 'Clasifica cada medida según el ámbito de seguridad de datos al que contribuye',
      type: 'classify',
      points: 4,
      categories: ['Protección de los datos', 'Control de acceso', 'Monitorización'],
      classifyItems: [
        { text: 'Registro de logs del sistema para trazabilidad', category: 'Monitorización' },
        { text: 'Data masking y tokenization', category: 'Protección de los datos' },
        { text: 'RBAC y mínimo privilegio', category: 'Control de acceso' },
        { text: 'Cifrado en reposo y en tránsito', category: 'Protección de los datos' },
        { text: 'MFA y SSO', category: 'Control de acceso' },
        { text: 'Detección de data drift y anomalías', category: 'Monitorización' },
      ],
      explanation:
        'Un marco de gobernanza combina protección, control de acceso y monitorización continua de los datos y los modelos.',
    },
    {
      id: 'd5-27',
      title: 'Clasifica cada necesidad según el servicio de AWS que la cubre',
      type: 'classify',
      points: 4,
      categories: ['AWS Artifact', 'AWS CloudTrail', 'AWS KMS'],
      classifyItems: [
        { text: 'Consultar las certificaciones SOC o ISO de AWS', category: 'AWS Artifact' },
        { text: 'Gestionar las claves de cifrado de los datos', category: 'AWS KMS' },
        { text: 'Descargar informes de compliance de AWS para un auditor', category: 'AWS Artifact' },
        { text: 'Auditar las acciones realizadas sobre recursos de IA', category: 'AWS CloudTrail' },
        { text: 'Cifrar con claves propias los datos de entrenamiento en S3', category: 'AWS KMS' },
        { text: 'Registrar quién llamó a una API y cuándo', category: 'AWS CloudTrail' },
      ],
      explanation:
        'Artifact da acceso a los informes de compliance, CloudTrail audita la actividad de la API y KMS gestiona las claves de cifrado.',
    },
  ],
};

export const testSimulacro: TestConfig = {
  id: 'aif-simulacro',
  title: 'Simulacro AIF-C01: repaso mixto',
  numberOfQuestions: 20,
  time: 30,
  pointsType: 'over10',
  minForPass: 7,
  onTimeUp: 'warn',
  questions: [
    {
      id: 'sim-1',
      title: 'Una startup permite que los usuarios suban sus propias imágenes y quiere evitar que se publiquen imágenes no aptas. ¿Qué solución es la más adecuada?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon Polly con voces neurales',
        'Amazon Textract con detección de formularios',
        'Amazon Comprehend con análisis de sentimiento',
        'Amazon Rekognition con content moderation',
      ],
      correctAnswer: 3,
      explanation:
        'Rekognition detecta contenido inapropiado en imágenes y vídeo. Se puede añadir Amazon A2I para revisión humana de los casos dudosos.',
    },
    {
      id: 'sim-2',
      title: 'Una aseguradora recibe miles de formularios de reclamación escaneados. ¿Qué servicio extrae automáticamente sus datos?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon Textract',
        'Amazon Translate',
        'Amazon Kendra',
        'Amazon Rekognition',
      ],
      correctAnswer: 0,
      explanation:
        'Textract extrae texto, escritura a mano, tablas y formularios de documentos escaneados.',
    },
    {
      id: 'sim-3',
      title: 'Un chatbot basado en un LLM genera respuestas muy distintas para el mismo prompt. ¿Qué debe hacer la empresa para que sean más consistentes?',
      type: 'select',
      points: 1,
      answers: [
        'Aumentar el número de epochs',
        'Usar un modelo de difusión',
        'Aumentar el tamaño de la ventana de contexto',
        'Reducir la temperature',
      ],
      correctAnswer: 3,
      explanation:
        'Una temperature baja produce respuestas más deterministas.',
    },
    {
      id: 'sim-4',
      title: 'Los accionistas no están satisfechos con el tono del chatbot de Bedrock. ¿Cuál es la solución más eficiente?',
      type: 'select',
      points: 1,
      answers: [
        'Ajustar las instrucciones del prompt (prompt engineering)',
        'Entrenar un modelo desde cero',
        'Hacer continued pre-training con un corpus enorme',
        'Migrar el chatbot a EC2',
      ],
      correctAnswer: 0,
      explanation:
        'Cuando varias opciones son válidas, el examen suele premiar la más eficiente en coste y esfuerzo; el prompt engineering lo es.',
    },
    {
      id: 'sim-5',
      title: 'Un chatbot científico con RAG está actualizado, pero falla con la terminología especializada. ¿Qué técnica debería aplicar?',
      type: 'select',
      points: 1,
      answers: [
        'Activar Guardrails',
        'Ampliar el número de chunks de RAG',
        'Continued Pre-Training con un gran corpus científico',
        'Reducir la temperature',
      ],
      correctAnswer: 2,
      explanation:
        'RAG aporta información actualizada; el Continued Pre-Training amplía el conocimiento del dominio.',
    },
    {
      id: 'sim-6',
      title: 'Una empresa sin data scientists quiere crear modelos de ML sin escribir código. ¿Qué servicio debe recomendarse?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon SageMaker Pipelines',
        'Amazon SageMaker Clarify',
        'Amazon SageMaker Canvas',
        'AWS Trainium',
      ],
      correctAnswer: 2,
      explanation:
        'Canvas es la interfaz no-code de SageMaker, con AutoML.',
    },
    {
      id: 'sim-7',
      title: 'Un equipo quiere empezar con modelos preentrenados de Hugging Face o Meta y personalizarlos con datos propios en SageMaker. ¿Qué servicio es adecuado?',
      type: 'select',
      points: 1,
      answers: [
        'SageMaker Ground Truth',
        'SageMaker JumpStart',
        'SageMaker Feature Store',
        'Amazon Personalize',
      ],
      correctAnswer: 1,
      explanation:
        'JumpStart es el hub de modelos y soluciones preconstruidas, personalizables y desplegables en SageMaker.',
    },
    {
      id: 'sim-8',
      title: 'Un modelo analiza los fotogramas de un partido de tenis para predecir quién ganará cada punto mientras se juega. ¿Qué despliegue necesita?',
      type: 'select',
      points: 1,
      answers: [
        'Batch Transform',
        'Inferencia en tiempo real',
        'Entrenamiento distribuido',
        'Inferencia asíncrona',
      ],
      correctAnswer: 1,
      explanation:
        'Se necesitan predicciones de baja latencia, una a una, conforme llegan los datos.',
    },
    {
      id: 'sim-9',
      title: 'Una empresa procesa un dataset de menos de 1 GB para una reunión semanal y no necesita respuesta inmediata. ¿Qué tipo de inferencia usa?',
      type: 'select',
      points: 1,
      answers: [
        'Inferencia en tiempo real',
        'Inferencia serverless',
        'Inferencia asíncrona',
        'Inferencia en el edge',
      ],
      correctAnswer: 2,
      explanation:
        'La asíncrona admite payloads de hasta 1 GB y procesamiento de hasta 1 hora; batch sería excesivo para un solo dataset.',
    },
    {
      id: 'sim-10',
      title: 'Una empresa quiere abaratar la ejecución de predicciones de un modelo ya entrenado en producción. ¿Qué chip de AWS usará?',
      type: 'select',
      points: 1,
      answers: [
        'AWS Graviton para entrenamiento',
        'AWS Fargate',
        'AWS Inferentia',
        'AWS Trainium',
      ],
      correctAnswer: 2,
      explanation:
        'Inferentia = inferencia (instancias Inf1) y Trainium = entrenamiento (instancias Trn1).',
    },
    {
      id: 'sim-11',
      title: 'Un modelo de evaluación de riesgo de préstamos penaliza a un grupo de personas. ¿Qué herramienta ayuda a detectar y explicar el sesgo?',
      type: 'select',
      points: 1,
      answers: [
        'AWS CloudTrail',
        'Amazon SageMaker Clarify',
        'Amazon Lex',
        'Amazon SageMaker Data Wrangler',
      ],
      correctAnswer: 1,
      explanation:
        'Clarify detecta sesgo en datos y modelos y explica cómo contribuyen las features a una predicción. Data Wrangler sirve después para rebalancear los datos.',
    },
    {
      id: 'sim-12',
      title: 'Una empresa necesita documentar el uso previsto, el risk rating y las métricas de entrenamiento de sus modelos. ¿Qué usa?',
      type: 'select',
      points: 1,
      answers: [
        'AWS AI Service Cards',
        'Amazon CloudWatch',
        'AWS Artifact',
        'SageMaker Model Cards',
      ],
      correctAnswer: 3,
      explanation:
        'Las Model Cards documentan los modelos del cliente; las AI Service Cards documentan los servicios de IA de AWS.',
    },
    {
      id: 'sim-13',
      title: 'Se quiere bloquear el tráfico de una dirección IP concreta que llega a una subnet. ¿Qué se debe usar?',
      type: 'select',
      points: 1,
      answers: [
        'Un Security Group con una regla Deny',
        'Una Network ACL con una regla Deny',
        'Un NAT Gateway',
        'Un VPC Endpoint',
      ],
      correctAnswer: 1,
      explanation:
        'Los Security Groups solo admiten reglas Allow; las NACL admiten Allow y Deny a nivel de subnet.',
    },
    {
      id: 'sim-14',
      title: 'Una aplicación en una subnet privada debe invocar un modelo de Bedrock sin que el tráfico atraviese Internet. ¿Qué configura?',
      type: 'select',
      points: 1,
      answers: [
        'Un NAT Gateway',
        'Un VPC Peering con una VPC pública',
        'Un VPC Endpoint (AWS PrivateLink)',
        'Un Internet Gateway',
      ],
      correctAnswer: 2,
      explanation:
        'Los VPC Endpoints conectan de forma privada con servicios de AWS sin salir a Internet.',
    },
    {
      id: 'sim-15',
      title: 'Un modelo de regresión predice las ventas futuras. ¿Qué métrica NO debe usarse para evaluarlo?',
      type: 'select',
      points: 1,
      answers: [
        'R-squared',
        'F1 Score',
        'RMSE',
        'MAE',
      ],
      correctAnswer: 1,
      explanation:
        'F1, precision, recall y accuracy son métricas de clasificación; en regresión se usan MSE/RMSE, MAE o R².',
    },
    {
      id: 'sim-16',
      title: 'Los empleados necesitan un asistente que responda con documentos internos de S3 y SharePoint respetando los permisos de cada usuario. ¿Qué servicio es el adecuado?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon Q Business',
        'Amazon Lex',
        'Amazon Forecast',
        'Amazon Q Developer',
      ],
      correctAnswer: 0,
      explanation:
        'Q Business usa RAG gestionado con conectores y controla qué documentos puede ver cada usuario o grupo.',
    },
    {
      id: 'sim-17',
      title: 'Una empresa quiere saber quién modificó la configuración de un recurso ayer. ¿Qué servicio consulta?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon GuardDuty',
        'AWS Budgets',
        'Amazon CloudWatch',
        'AWS CloudTrail',
      ],
      correctAnswer: 3,
      explanation:
        'CloudTrail registra las llamadas a la API con quién, cuándo y desde dónde.',
    },
    {
      id: 'sim-18',
      title: 'Un auditor pide los informes de compliance de AWS. ¿Dónde se obtienen?',
      type: 'select',
      points: 1,
      answers: [
        'AWS Artifact',
        'Amazon Inspector',
        'AWS Shield',
        'AWS Config',
      ],
      correctAnswer: 0,
      explanation:
        'Artifact da acceso bajo demanda a los informes de seguridad y compliance de AWS.',
    },
    {
      id: 'sim-19',
      title: 'Una empresa necesita que miles de personas etiqueten imágenes de un dataset de entrenamiento pagando por tarea. ¿Qué servicio usa?',
      type: 'select',
      points: 1,
      answers: [
        'Amazon Comprehend',
        'AWS Glue',
        'Amazon PartyRock',
        'Amazon Mechanical Turk',
      ],
      correctAnswer: 3,
      explanation:
        'Mechanical Turk se integra con A2I y SageMaker Ground Truth para el etiquetado humano a escala.',
    },
    {
      id: 'sim-20',
      title: 'Una empresa cifra sus datos en Amazon S3. Según el modelo de responsabilidad compartida, ¿quién es responsable de configurar ese cifrado?',
      type: 'select',
      points: 1,
      answers: [
        'AWS',
        'El cliente',
        'El proveedor del modelo',
        'Ambos a partes iguales',
      ],
      correctAnswer: 1,
      explanation:
        'El cifrado de los datos del cliente, en reposo y en tránsito, es responsabilidad del cliente.',
    },
    {
      id: 'sim-21',
      title: 'Un banco quiere comprobar que su política de IA responsable se cumple con revisiones periódicas técnicas y no técnicas. ¿Qué componente del marco de gobernanza lo cubre?',
      type: 'select',
      points: 1,
      answers: [
        'El aumento de la ventana de contexto',
        'La reducción de dimensionalidad',
        'La cadencia de revisión, con revisiones técnicas y no técnicas',
        'La cuantización del modelo',
      ],
      correctAnswer: 2,
      explanation:
        'El marco de gobernanza incluye comité, roles, políticas y una cadencia de revisión explícita con SMEs, legal, cumplimiento y usuarios finales.',
    },
    {
      id: 'sim-22',
      title: 'Una empresa quiere desarrollar soluciones con LLMs en AWS con escalabilidad, seguridad e integración con otros servicios. ¿Qué DOS servicios son adecuados?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Amazon Rekognition',
        'Amazon Textract',
        'Amazon SageMaker',
        'Amazon Bedrock',
        'Amazon Polly',
      ],
      correctAnswer: [2, 3],
      explanation:
        'Bedrock da acceso gestionado y serverless a Foundation Models con Knowledge Bases, Agents y Guardrails; SageMaker permite entrenar, ajustar y desplegar modelos propios, incluidos los de JumpStart.',
    },
    {
      id: 'sim-23',
      title: '¿Qué medidas ayudan a reducir el riesgo de prompt injection en una aplicación de IA generativa?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Sanitizar y validar las entradas',
        'Subir la temperature',
        'Implementar Guardrails',
        'Desactivar el registro de actividad',
        'Filtrar los prompts',
      ],
      correctAnswer: [0, 2, 4],
      explanation:
        'La inyección de prompts se controla con guardrails, filtrado y validación de las entradas.',
    },
    {
      id: 'sim-24',
      title: '¿Qué beneficios aporta RAG?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Reduce las alucinaciones',
        'Puede incluir referencias a los documentos fuente',
        'Permite usar información actualizada sin reentrenar el modelo',
        'Garantiza que el 100 % de las respuestas sean correctas',
        'Elimina la necesidad de embeddings',
      ],
      correctAnswer: [0, 1, 2],
      explanation:
        'RAG mejora la precisión y la transparencia, pero no elimina por completo las alucinaciones y sí necesita embeddings y una vector database.',
    },
    {
      id: 'sim-25',
      title: '¿Qué estrategias reducen el overfitting?',
      type: 'multiselect',
      points: 2,
      answers: [
        'Aumentar la complejidad del modelo',
        'Más datos de entrenamiento',
        'Entrenar más epochs sin control',
        'Early stopping',
        'Regularización',
      ],
      correctAnswer: [1, 3, 4],
      explanation:
        'También ayudan cross-validation, dropout y data augmentation.',
    },
    {
      id: 'sim-26',
      title: 'Relaciona cada servicio con lo que hace',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'Amazon Textract', right: 'Extraer texto impreso, manuscrito y datos de documentos' },
        { left: 'Amazon Forecast', right: 'Predecir resultados de negocio a partir de series temporales' },
        { left: 'Amazon Kendra', right: 'Búsqueda empresarial inteligente con ML' },
        { left: 'Amazon Personalize', right: 'Recomendaciones personalizadas en tiempo real' },
      ],
      explanation:
        'Las preguntas de elección de servicio se resuelven identificando qué problema resuelve cada uno.',
    },
    {
      id: 'sim-27',
      title: 'Relaciona cada necesidad de gobierno y operación con el servicio de AWS',
      type: 'match',
      points: 3,
      matchPairs: [
        { left: 'Saber quién cambió una configuración', right: 'AWS CloudTrail' },
        { left: 'Comprobar si los recursos cumplen la configuración deseada', right: 'AWS Config' },
        { left: 'Parchear y operar servidores a escala', right: 'AWS Systems Manager' },
        { left: 'Gobernar varias cuentas con políticas centralizadas', right: 'AWS Organizations' },
      ],
      explanation:
        'Config evalúa conformidad, CloudTrail audita la API, Systems Manager opera nodos y Organizations aplica SCP a OUs y cuentas.',
    },
    {
      id: 'sim-28',
      title: 'Clasifica cada escenario según el tipo de aprendizaje automático',
      type: 'classify',
      points: 4,
      categories: ['Supervisado', 'No supervisado', 'Por refuerzo'],
      classifyItems: [
        { text: 'Reducir variables con PCA', category: 'No supervisado' },
        { text: 'Predecir el abandono de clientes con datos históricos etiquetados', category: 'Supervisado' },
        { text: 'Agrupar clientes por comportamiento sin etiquetas', category: 'No supervisado' },
        { text: 'Optimizar un chatbot con feedback humano (RLHF)', category: 'Por refuerzo' },
        { text: 'Un robot que aprende a caminar por recompensas', category: 'Por refuerzo' },
        { text: 'Detectar fraude con transacciones históricas etiquetadas', category: 'Supervisado' },
      ],
      explanation:
        'Con etiquetas y un objetivo claro: supervisado; sin etiquetas: no supervisado; un agente que maximiza recompensas: refuerzo.',
    },
    {
      id: 'sim-29',
      title: 'Clasifica cada servicio según el tipo de datos o tarea principal',
      type: 'classify',
      points: 4,
      categories: ['Visión y documentos', 'Lenguaje (texto)', 'Voz'],
      classifyItems: [
        { text: 'Amazon Rekognition', category: 'Visión y documentos' },
        { text: 'Amazon Textract', category: 'Visión y documentos' },
        { text: 'Amazon Transcribe', category: 'Voz' },
        { text: 'Amazon Polly', category: 'Voz' },
        { text: 'Amazon Comprehend', category: 'Lenguaje (texto)' },
        { text: 'Amazon Translate', category: 'Lenguaje (texto)' },
      ],
      explanation:
        'Rekognition y Textract analizan imágenes y documentos; Comprehend y Translate trabajan con texto; Polly y Transcribe convierten entre texto y voz.',
    },
  ],
};
