# Cierres - Mesa enfocada

Aplicacion Electron para Windows. Registra casos actuales, confirma sus cierres y lleva una meta de cinco cierres por semana. No requiere una cuenta, un servidor remoto ni conexion a Internet para funcionar.

## Descargar e instalar

Descarga los ejecutables desde [Releases](https://github.com/EduardoCordova-DEV/closures/releases/latest). Requieren **Windows 10/11 de 64 bits (x64)**. No necesitas instalar Node.js, npm ni SQLite para usarlos.

| Archivo | Uso | Ubicacion de casos y respaldos |
| --- | --- | --- |
| `Cierres-Setup-1.0.0-x64.exe` | Instala para tu usuario y agrega Cierres al menu Inicio | `%APPDATA%\Cierres` |
| `Cierres-Portable-1.0.0-x64.exe` | Se ejecuta sin instalacion | `Cierres-data` junto al ejecutable |
| `SHA256SUMS.txt` | Hashes para verificar las dos descargas | No contiene datos de casos |

### Instalacion local

1. Descarga y ejecuta `Cierres-Setup-1.0.0-x64.exe`.
2. La instalacion por usuario no requiere administrador; se guarda en `%LOCALAPPDATA%\Programs\Cierres`.
3. Abre **Cierres** desde Inicio. El instalador no abre la app automaticamente.
4. Para actualizar, guarda los formularios, cierra Cierres y ejecuta el nuevo instalador. El tracking de `%APPDATA%\Cierres` se conserva, tambien si antes usabas la instalacion mediante PowerShell.

Puedes desinstalar desde **Configuracion de Windows > Aplicaciones**. La desinstalacion conserva los datos; exporta un respaldo antes de cambiar de equipo.

### Version portable

1. Coloca `Cierres-Portable-1.0.0-x64.exe` en una carpeta con permisos de escritura, en tu disco o en una memoria USB.
2. Ejecutalo. Al primer inicio crea **`Cierres-data` junto al EXE**, con la base, respaldos y archivos locales de la interfaz. No crea accesos ni modifica el PATH.
3. Para llevar el tracking a otro equipo, cierra la app y copia **el EXE y toda la carpeta `Cierres-data`**. No desconectes la unidad mientras la app siga abierta.
4. Para actualizar, cierra la app y reemplaza solamente el EXE; conserva `Cierres-data`. Evita abrir dos versiones sobre los mismos datos.

La portable no lee ni mueve automaticamente los casos de la version instalada. Para trasladarlos, usa **Datos y respaldos > Exportar respaldo** en el origen y **Restaurar respaldo** en el destino. Restaurar reemplaza los datos del destino, no los combina.

No uses carpetas de solo lectura ni sincronizadas mientras la app este abierta. Si no puede abrir su carpeta de datos, muestra un error: no cambia silenciosamente a otra base.

### Verificar la descarga

En PowerShell, desde la carpeta de descarga:

```powershell
Get-FileHash .\Cierres-Setup-1.0.0-x64.exe -Algorithm SHA256
Get-FileHash .\Cierres-Portable-1.0.0-x64.exe -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

Compara los hashes. Los ejecutables **no estan firmados con un certificado de editor**; Windows SmartScreen o las politicas de tu organizacion pueden mostrar una advertencia o impedir su ejecucion. Descarga solo de este repositorio y respeta las politicas de tu equipo; no desactives las protecciones.

## Uso

Abre **Cierres** desde Inicio o ejecuta el EXE portable. El comando `closures` se agrega al PATH cuando usas el instalador PowerShell desde el codigo (`npm run install:local`); el instalador EXE no modifica el PATH.

- **Registrar caso** agrega un caso activo. No aumenta el conteo de cierres.
- Cada caso muestra sus **dias abierto**, desde la fecha de apertura registrada hasta hoy, en una columna destacada entre la descripcion y el estado, ademas del panel lateral y la confirmacion de cierre. Son dias naturales: semanas completas de siete dias, incluidos sabados y domingos. El dia de apertura muestra 0 y el siguiente muestra 1; no se usa la fecha de captura.
- Los casos activos aparecen del mas antiguo al mas reciente por fecha de apertura, tambien al buscar y al elegir un caso para cerrar. La seleccion manual se conserva.
- La meta es cerrar **antes de 14 dias naturales**. El indicador es **verde de 0 a 5 dias**, **amarillo de 6 a 13** y **rojo desde los 14**, tanto en la tabla como en el panel lateral y la confirmacion de cierre. En Cerrados el color corresponde a la duracion hasta el cierre; se mantiene su orden por fecha de cierre. Son avisos visuales: no cierran casos automaticamente ni impiden cerrarlos fuera de plazo.
- La antiguedad se actualiza automaticamente al cambiar el dia o volver a la ventana. En Cerrados se muestra el total hasta la fecha de cierre y deja de aumentar. Corregir fechas recalcula el total; reabrir vuelve a contar desde la apertura original hasta hoy, sin descontar intervalos anteriores.
- Selecciona un caso y pulsa **Cerrar Caso**. Confirma el caso y su fecha.
- La semana laboral va de lunes a viernes, usando fechas locales del equipo. La meta sigue siendo cinco cierres y cuenta por fecha de cierre, no por fecha de captura. Las flechas avanzan siete dias, de un lunes al siguiente.
- Las fechas de cierre nuevas o corregidas deben ser de lunes a viernes. No se borran ni se cambian las fechas de registros o respaldos existentes.
- Usa las flechas para consultar semanas anteriores y la busqueda para localizar casos.
- El lapiz permite corregir datos o la fecha de un cierre. **Reabrir caso** lo devuelve a Activos y retira su cierre de la semana original.
- **Eliminar caso** lo oculta y lo excluye del conteo. Se conserva su historial en la base y en los respaldos; el ID no se puede reutilizar.
- Un caso actualmente cerrado cuenta una sola vez. Si se reabre y se cierra nuevamente, cuenta en la fecha del cierre mas reciente.

## Guardado y respaldos

En la version instalada, la base se guarda en `%APPDATA%\Cierres\tracking.sqlite`, fuera de la carpeta del proyecto y de OneDrive. En la portable se guarda en `Cierres-data\tracking.sqlite` junto al EXE. Cerrar la ventana no borra el tracking. Actualizar el ejecutable tampoco.

Se usa SQLite con transacciones, WAL y sincronizacion completa. Solo se muestra confirmacion cuando la escritura finaliza. La base se verifica al iniciar; ante un error no se sustituye por una base vacia.

**Datos y respaldos** permite exportar un respaldo JSON completo, restaurarlo, exportar los casos visibles a CSV y abrir la carpeta de datos. Restaurar **reemplaza** el tracking actual, previa confirmacion; no combina bases. Antes de restaurar se crea una copia SQLite de seguridad.

En `backups` se conserva una copia SQLite por dia de uso, tomada al comenzar el dia antes de modificar datos. No es una copia despues de cada cambio. Las copias no se borran automaticamente. El JSON exportado contiene los casos, registros eliminados e historial de cambios.

Los respaldos SQLite se pueden recuperar con la aplicacion cerrada mediante herramientas SQLite. No reemplaces un archivo de base de datos mientras la aplicacion este abierta ni mezcles archivos WAL de distintas bases. Para recuperacion normal, usa el respaldo JSON desde la interfaz.

Los archivos no estan cifrados por la aplicacion. En la instalacion local se protegen mediante tu cuenta de Windows; en la portable, cualquier persona con acceso a la carpeta o USB puede leerlos. No guardes contrasenas, tokens ni informacion innecesaria de clientes. Una copia en el mismo disco no protege de una falla del disco: exporta un JSON a otra ubicacion segura cuando lo necesites.

El repositorio y los ejecutables no incluyen casos reales, bases de datos ni respaldos. Una instalacion nueva empieza vacia.

## Desarrollo

Requiere Node.js >= 22.12 y npm. Electron incluye su propio runtime y SQLite, sin modulos nativos adicionales.

```powershell
git clone https://github.com/EduardoCordova-DEV/closures.git
Set-Location closures
npm ci
npm run dev
```

Para ejecutar la compilacion de produccion:

```powershell
npm run build
npm start
```

Para validar y empaquetar:

```powershell
npm test
npm run build
npm run test:electron
npm run package
npm run install:local
```

El instalador local copia el ejecutable a `%LOCALAPPDATA%\Programs\Cierres`, crea un acceso en Inicio y agrega su directorio `bin` al PATH del usuario para el comando `closures`. Al actualizar, retira el comando anterior `cierres` si no fue modificado. No requiere administrador ni modifica el perfil de PowerShell. El codigo permanece en esta carpeta.

Para generar los dos EXE distribuibles y sus hashes:

```powershell
npm run package:release
npm run test:portable
```

Se generan en `release`. El empaquetado debe hacerse en Windows x64, requiere Internet para descargar herramientas de Electron/NSIS y no publica automaticamente en GitHub. Sube los dos EXE y `SHA256SUMS.txt` como assets de una Release; no los agregues al historial Git. Para otra version, actualiza `package.json` y `package-lock.json` con `npm version X.Y.Z --no-git-tag-version` y ajusta los nombres en estas instrucciones.

La interfaz usa React y TypeScript; SQLite solo es accesible desde el proceso principal. El renderer esta aislado, sin Node, con sandbox y un puente IPC limitado. Los tests Electron usan una carpeta temporal separada y no tocan el tracking real. El test portable usa una copia del EXE en una carpeta temporal y datos sinteticos; no ejecuta el instalador sobre la cuenta del usuario.
