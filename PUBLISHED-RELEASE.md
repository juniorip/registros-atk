# Publicación del rediseño — 30/10/2026

- URL: https://registros-atk.vercel.app/
- Proyecto: registros-atk, junioripanaque3cta-7204s-projects.
- Despliegue activo: dpl_ZVv6tH7qjFxjTxf9euxYu768q8Xy.
- Paquete publicado: ../registros-atk-release-20261030/.
- Fuente de trabajo del rediseño: esta carpeta (registros-atk-redesign).
- REGISTROS_MAINTENANCE de Production: 0. Mantenimiento retirado con autorización del usuario al publicar.
- La base productiva y las integraciones existentes se conservaron. No se restauraron datos locales ni se ejecutaron migraciones.
- La carpeta publicada no contiene .env, cuentas de prueba, respaldo de datos ni archivos SQLite.
- La compilación local y de Vercel, TypeScript, conservación de lógica y pruebas de comparativos/estadísticas pasaron.
- Dominio público HTTP 200; CSS y JS coinciden por SHA-256 con lo revisado; Las APIs exigen sesión o firma: estado y webhook 401; asistencia redirige 307 al login sin sesión.
- Pantalla pública de login comprobada visualmente, sin errores de consola. No se probó una sesión productiva autenticada.
- Evidencia: validation/production-release-20261030.json y ../../outputs/rediseno-local/vercel-publicado-20261030.png.
- El respaldo previo al rediseño permanece en ../../backups/.

Usar el perfil Vercel C:/Users/User/.vercel-profiles/registros-atk. El perfil predeterminado corresponde a otro proyecto.

## Sueldos, asistencia y continuidad — 20261030-payroll-continuity-v13

- Tardanza acumulada en horas y minutos; llegada tarde en rojo.
- Desde 31/10/2026: jornada proyectada según horario individual, sin crear ni modificar marcajes. Horas extra reales del último día excluidas del mes de origen e incluidas únicamente en el siguiente, con tarifa y días laborables del mes de origen.
- Lectura del último día anterior con correcciones y calendario, sin migraciones ni escrituras de asistencia.
- Gratificación, detalles abiertos y posición conservados al repintar la misma vista. Reportes individuales y detallados incluyen el arrastre en desglose y totales.
- Pruebas financieras, contexto anterior, conservación de lógica, compilación local y publicación Vercel correctas. Verificación visual local: refresco 1294→1294, gratificación abierta; cerrar detalle 713→713, gratificación abierta; llegada 09:37 en rgb(255,105,124); tardanza acumulada 0 h 10 min.
- Evidencia: validation/production-payroll-continuity-20261030.json. Versión pública y activos revisados coinciden exactamente. No se probó una sesión productiva autenticada ni se crearon marcajes.

- Ajuste visual v14: relojes de entrada/salida sin salto de línea ni encogimiento; etiquetas pueden pasar debajo. Verificados 1200 relojes locales sin división y activos publicados coincidentes. Evidencia: ../../outputs/rediseno-local/asistencia-horas-completas.png.

- v15: duración acumulada junto al número de tardanzas; fila acumulada separada eliminada. Publicación y activo verificados.

- v16: indicador circular en inicio y 16 estados de carga; navegación permite pintar el indicador antes del trabajo pesado. Peticiones fallidas retiran el indicador y actualizaciones silenciosas conservan su comportamiento. Pruebas: validation/loading-feedback-20261030.json. Versión pública, estado accesible y activos verificados.

- v17: gratificación por meses calendario completos hasta fecha Lima, reducción de 1/30 por día no computable registrado; tardanzas/horas extra no alteran meses. Datos faltantes y días justificados sin clasificación se señalan por verificar. Sueldos carga historia completa con caché separada de Asistencia mensual. Horas del semestre completas; regularidad de comisiones y horas extra separadas; incluye arrastre del mes anterior en variables. Factor existente 50% y exclusión de bonificación/EPS conservados. Sin escrituras productivas ni cambios de API. Pruebas y publicación: validation/production-gratification-20261030.json; vista local: ../../outputs/rediseno-local/gratificacion-corregida.png.

- v18: decisiones de calificaciones usan snapshots persistidos sin sincronizar Excel en ese POST; respuesta devuelve fila guardada y evita GET completo posterior. Sincronización habitual de Excel se conserva en lecturas normales. Validaciones existentes mantenidas; caché de sueldos invalidada y respuestas antiguas protegidas. Pruebas de permisos, validez, mes cerrado, confirmación persistida, una solicitud y concurrencia pasaron. TypeScript y Vercel correctos. Dominio/activo y 401 sin sesión verificados. Evidencia: validation/production-rating-speed-20261030.json. No se aprobaron calificaciones productivas ni se midió aún una aprobación productiva autenticada.

- v20: casillas de solicitudes de asistencia centradas, 18×18 px, fondo oscuro, bordes suaves, selección azul y foco visible. Verificado en vista local al seleccionar/desmarcar sin aprobar solicitudes; CSS público coincide. Evidencia: ../../outputs/rediseno-local/asistencia-solicitudes-casillas.png. Solo CSS y versión de activos modificados.

- v21: alertas mensuales de revisión de cambios de asistencia, visibles al admin, umbral tres fechas distintas y señales de solicitud propia. Distingue marcajes faltantes y reducción/justificación de tardanza según horario; rechazadas fuera del umbral y reenvíos del mismo día sin duplicar. Incluye detalle de motivo, solicitante, horas guardadas al solicitar y estado; patrones por solicitante con varios colaboradores. Reglas locales sin servicios externos ni decisiones automáticas. Test: scripts/test-attendance-review-alerts.cjs; regresión de lógica y APIs pasada. Dominio y activos verificados.

## Suplemento de horas extra septiembre — 20261031-september-overtime-v22

- Excel del administrador del 30/09/2026: 21 colaboradores, 19 con entrada/salida, 2 sin salida excluidos.
- Fuente privada en servidor, SHA-256 conservado; suplemento calculado segun horario y tarifa del mes origen, solo en octubre. Disponible tambien al consultar octubre desde meses futuros.
- No modifica marcajes ni cierre de septiembre. Conserva las salidas reales para el suplemento, evitando la antigua proyeccion de cierre a las 18:00.
- TypeScript, pruebas de arrastre, gratificacion, conservacion de logica y compilacion Vercel correctos. Dominio 200, version v22 y JS exacto comprobados. No se verifico una nomina autenticada productiva.


## Seleccion de sueldo — 20261031-salary-selection-v23

- Paginar no borra la persona seleccionada. La seleccion se valida contra todas las filas filtradas, no solo las siete visibles; conserva el desglose al cambiar pagina.
- Sintaxis JavaScript, build Vercel y archivos publicados verificados. No cambia calculos ni datos.


## Referidos para jefes — 20261031-referral-managers-v24

- Restaurado validar/rechazar referidos pendientes en la sede autorizada del jefe, tanto interfaz como API. Admin conserva alcance global; cuenta temporal de consulta, separacion de Pagos, sede historica y meses cerrados conservados.
- No se cambia el estado de ningun referido existente. Pruebas de permisos cliente/servidor y TypeScript correctas.


## Cierre segun horario — 20261031-closing-shift-v25

- Desde 31/10 la proyeccion de salida del cierre respeta el horario individual (Nicolle 18:30), en lugar de imponer 18:00. Si existe salida real, se conserva para calcular arrastre de horas extra.
- Septiembre y otros cierres anteriores no cambian; suplemento de septiembre independiente conservado. Pruebas de 18:30 proyectado, 19:00 real, arrastre y TypeScript correctas.


## Seccion al recargar — 20261031-remember-section-v26

- F5 restaura la ultima seccion de la misma pestaña despues de validar la sesion. Preferencia por usuario en sessionStorage y limitada a secciones de su menu/rol; cerrar sesion elimina la preferencia. No persiste credenciales adicionales ni formularios.
- Prueba de boot/recarga, usuario distinto, vista no disponible, cambio obligatorio de contraseña y logout correcta. Sintaxis y conservacion de logica verificadas.


## Historial salarial — 20261031-salary-history-v27

- Historial por mes de vigencia en extraBonuses.__salaryHistory, protegido en el servidor. Recuperacion confirmada de Franco: septiembre 2000 / octubre 2500; periodos anteriores señalados como no verificados. Sin migraciones ni reescritura de pagos/cierres.
- Perfil salarial anterior preservado al editar, correccion retroactiva conserva el ultimo sueldo, mes valido hasta el actual, auditoria antes/despues con actor. Editor independiente del mes financiero consultado; guardar bonos no vuelve a guardar un sueldo historico como actual.
- Sueldo/horas extra segun mes origen; base fija de gratificacion junio/noviembre. Proyecciones y vigencias faltantes señaladas. Nuevos controles de vigencia/historial en editor.
- Comparacion de respaldo 29/10 con configuracion anterior documentada en ../../outputs/revision-sueldos-20261031.md. Fechas de otros aumentos no inferidas.
- TypeScript, historial/backdating/seguridad, grati, arrastre, origen septiembre y conservacion de logica correctos. Backup de codigo previo ../../backups/salary-history-20261031-before/.


## Falta sin pago — 20261031-attendance-absence-v28

- Selector Falta en editar asistencia: sin horas visibles, Sin marcaje, dia no trabajado/no pagado, sin proyeccion de cierre ni horas extra. Dia no computable para gratificacion segun reglas existentes.
- Indicador persistido por fecha en el perfil; marcajes originales y correcciones previas conservados. Retirar falta recupera la asistencia original. Sin migraciones.
- Jefes mantienen solicitudes y aprobacion del admin. Tipo de solicitud visible en motivo [FALTA]/[ASISTENCIA]; solicitudes antiguas conservan comportamiento. Metadata protegida contra cambios por formulario de colaboradores.
- Auditoria de aplicacion/retiro y pruebas de persistencia, salario, grati, flujo de aprobacion y restauracion correctas; TypeScript y build correctos. No se marcaron faltas reales.


## Historial general separado — 20261031-general-audit-v29

- Historial admin con General, Asistencias, Aprobados, Rechazados, Creados, Modificados, Eliminados y Sistema. Filtros de modulo, usuario/texto y fechas Lima; paginacion en servidor, 40 por pagina y contador. Antes/despues expandible y escapado.
- Exclusion en servidor de actorId 1, cuenta canonica Admin General confirmada en respaldo; conserva Jhonatan (id 82) y otros usuarios. No borra registros almacenados. Eventos sin actor en Sistema para no mezclar Zlink con acciones humanas.
- Ampliado registro despues de operaciones exitosas: decisiones de registros/referidos/llamadas/tarjetas/penalidades/calificaciones, ediciones y eliminaciones, solicitudes/asistencia, perfiles/pagos, configuracion y cierres. Se conservan permisos, bloqueos, estados y reglas financieras. Datos secretos y evidencia base64 excluidos del detalle de auditoria.
- No se inventa historia antigua faltante. Se conservan eventos existentes y se registran acciones nuevas desde activacion. Sin migraciones ni aprobaciones reales de prueba.
- Pruebas de filtros/exclusion/secretos/fechas/paginacion/roles/fallos, flujo de asistencia y permisos de referidos, decision rapida, TypeScript y compilacion Vercel correctos. Produccion 200, auditoria anonima 401, JS exacto. No se inspecciono una sesion productiva autenticada.
- Respaldo de archivos previos: ../../backups/general-audit-20261031-before/.


## Historial legible — 20261031-readable-history-v30

- JSON tecnico sustituido por tabla de campos modificados Antes/Despues; alias de entrada/salida normalizados, horas cortas, estados y etiquetas legibles. Asistencia sin marcajes a dia justificado se muestra como cambio de Estado, sin horas ficticias 00:00.
- Altura maxima 240px en detalle y celdas exteriores alineadas arriba. Se conservan los registros y filtros; solo presentacion.
- Regresion del caso Danna, cambio 09:24 a 09:04, omision de campos sin cambios y escape de contenido correctos. JS/CSS publicados exactos y dominio 200 comprobados.


## Tarjeta de sueldo adaptable — 20261031-salary-responsive-v31

- Quitado minimo fijo de 660px de la tabla diaria. Ocho columnas adaptables, estados largos envolventes, encabezados compactos con titulo/etiqueta accesible completa. Descuento y total permanecen visibles.
- Laptop 1201-1500: mayor proporcion para detalle; hasta 1200: tarjeta en fila completa; hasta 640: detalle diario en bloques etiquetados sin ocultar campos. No se modifican calculos ni pagos.
- Prueba visual con datos sinteticos y estilos reales a 1366, 1920 y 1024: ancho interno igual al desplazable en los tres, sin recorte horizontal. Captura: ../../outputs/rediseno-local/sueldo-asistencia-laptop-1366.png. Viewport restaurado y servidor temporal detenido.
- Produccion 200 y JS/CSS exactos comprobados; sin datos de prueba publicados.


## Ajustes de bonos visibles en laptop — 20261031-bonus-laptop-v33

- Ajustes de bonos colocado inmediatamente debajo de Desglose/Asistencia, con control mas visible y botones que envuelven en pantallas angostas. Se mueven los mismos elementos autorizados, sin modificar permisos ni handlers financieros.
- Editor de bonos limitado a altura del viewport, con lista desplazable y acciones fuera de esa lista. Prueba a 1366x640 con 16 bonos sinteticos: tarjeta entre y=16 y=624; botones terminan y=599.8; lista 416px con contenido de 1126px. Guardar y Cancelar visibles sin desplazar toda la ventana.
- Jona corresponde a administrador; no se cambiaron roles. Meses cerrados y otras restricciones se conservan. No se guardaron bonos de prueba.
- JS valido, produccion 200 y assets exactos verificados. Captura ilustrativa: ../../outputs/rediseno-local/ajustes-bonos-laptop.png. Viewport restaurado y servidor temporal detenido.


## Boleta sin ceros por periodo de Reportes — 20261031-receipt-month-v34

- Descarga usa salaryMonthKey de la persona seleccionada (o mes visible de sueldo) de forma explicita; no usa el periodo predeterminado anterior de Reportes para jefes. El sueldo pagado mostrado en pantalla se conserva como fuente de importes del PDF; el contexto del reporte no lo reemplaza por una recalculacion vacia.
- Se valida/carga el contexto de asistencia al descargar y se descarta si cambia usuario o mes durante la espera. Conservado requisito de sueldo marcado pagado.
- Regresion con render HTML real: Reportes septiembre frente a sueldo octubre, recálculo 0 frente a pagos positivos, mes historico, asistencia, estado pagado y popup bloqueado. Sin cambios de datos financieros.
- Sintaxis, conservacion de logica, bundle, build Vercel y dominio 200 correctos. No se descargo boleta real autenticada.


## Principal atkportal.app — 2026-10-31
- Deployment dpl_8P9NLvciNJhBcCEudkMhg47CarZY. Dominio principal 200 HTTPS. Visitas GET/HEAD a páginas en registros-atk.vercel.app y registros.atkportal.app redirigen 307, conservando rutas y query. API, webhook Zlink, recursos estáticos y mantenimiento conservados. Sin cambios de datos. Prueba proxy e integración pública PASS.

## Actualizaciones sin recalcular datos idénticos — 20261031-efficient-refresh-v35
- Deployment dpl_EaMxAtcihgPzhUwzPyYVWdR8Jpoj, atkportal.app. /api/state valida autenticacion antes de revision: hash de metadatos por tablas, usuario, rol, sede, nombre, periodo, modulos y dia Lima. COUNT detecta borrados; updatedAt cambios y aprobaciones. Una consulta UNION ALL de metadatos evita reconstruir y transferir filas al no cambiar. No cache compartido de respuestas privadas.
- Cliente conserva datos y cache de sueldo si estado/asistencia no cambiaron; no repinta innecesariamente. Escribe invalida revisiones; respuestas previas a una escritura se descartan. Reemplazo de colecciones y restauracion de meses invalidan revisiones. Asistencia mantiene sondeo de 15 segundos todo el dia; sin congelarla hasta las 18:00.
- readAttendanceData paraleliza lecturas independientes; comparacion local exacta antes/despues identica para septiembre, octubre y todo el historial.
- Benchmark local real de solo lectura: respuesta completa 1214076 bytes versus 96 bytes sin cambios; lecturas de metadatos 7 ms calientes versus reconstruccion 174–182 ms. No son mediciones de latencia en produccion. Pruebas de auth/mes/usuario/escritura/respuesta tardia, sueldos, faltas, gratificacion, horas extra, boleta y tsc PASS. Dominio 200, bundle exacto, estado anonimo 401 y redireccion antigua 307. Sin cambios financieros.

## Apertura Sueldos: mes primero, gratificacion bajo demanda — v36
- Deployment dpl_DF5kt7MJcWTDJ45RkYQc68otiHqe; version 20261031-salary-month-first-v36. Entrada Sueldos solicita month seleccionado; ya no descarga todo el historial ni calcula seis meses de gratificacion oculta. Abrir el apartado avanzado o pulsar Ver gratificacion solicita historial completo antes de calcular. Claves separan mensual/historial; cambio de sesion y mes impide mezclar datos. Error de historial restaura la asistencia mensual anterior, con alerta y reintento manual.
- getSalaryPeople, computeAttendancePayment y buildGratificationRows identicos a v35. Carry anterior, tasas historicas, gratificacion y boleta pasan pruebas. Sondeo intacto. Comparacion local bytes 1843145 historial vs 408429 mes octubre, 4192 vs 800 dias; no se afirma una latencia de produccion.
- Dominio 200 y ambos bundles exactos verificados. Sin cambios en registros, importes ni pagos.

## Speed Insights — v37
- Deployment dpl_2McPSz5oxfTiUuxtCJwZvLZrg6Az. Se integra script oficial en public/legacy.html (la interfaz real la sirve src/app/route.ts, no el layout React). Inicializador antes del script defer; una sola carga. beforeSend quita query/hash y descarta localhost/previews. Sin modificaciones de logica, datos ni APIs.
- API del proyecto confirma SpeedInsights id existente; script oficial 200 antes y despues del despliegue. HTML 200, inicializador exacto 200 y script oficial JS 200. Pruebas de redaccion, orden e idempotencia PASS. No se generaron mediciones sinteticas ni se afirma que ya existan metricas reales en el dashboard; requiere visitas reales.

## Adaptacion para celulares — v38
- Deployment dpl_BhshMNafEcYQu7WccYwbgHPJAz6n, cache 20261031-mobile-v38. Nuevos mobile-layout.css/js, una llamada presentacional al final de render. Menu de pantalla pequena con etiquetas, cerrar/tecla Escape/teclado; fondo y encabezado. Tablas reutilizan celdas/botones existentes con etiquetas en tarjetas. Selector de colaborador en sueldo usa click existente, desglose arriba y desplazamiento solo por seleccion expresa. Formularios en columna, controles tactiles y botones de modal accesibles.
- Local verificado admin: dashboard, estadisticas, colaboradores, asistencia, sueldos, calificaciones, referidos, safetypay. Menu, seleccion Danna, pestana asistencia, abrir/cancelar formulario sin persistir. Sin desplazamiento global extra a 320/390/430 px. Escritorio 1366: menu movil oculto, sidebar visible, tablas nativas. Captura outputs/movil/dashboard-celular.png en copia local.
- Conservacion de 434 funciones originales y 23 API sin cambios PASS; sintaxis y build de Vercel correctos. Dominio 200 y tres assets exactos comprobados. No se modificaron datos ni calculos financieros.

## Calificaciones: lecturas agrupadas para decidir — backend posterior a v38
- Deployment dpl_EibGwgxZH5mTjRpvc36Td6fqeqVu. El pool de Prisma usa una conexion; solo Promise.all no mejora sus consultas serializadas. Nueva lectura persistida de settings/usuarios sin credenciales/snapshots/aprobaciones con decisor/supresiones en una consulta SELECT JSON. Reutiliza el mismo buildRatingsResponse y sus reglas; las lecturas normales con sincronizacion Excel conservan su ruta anterior. Fechas timestamp sin zona se interpretan UTC igual que Prisma. Upsert de decision y auditoria se esperan antes de responder.
- Server-Timing auth/decision y log minimo rating_decision_timing sin nombre/DNI/contenido. No se atribuyen los 7 segundos a una fase concreta sin medir una aprobacion real.
- Copia local con cliente que bloquea escrituras: 7563 filas exactamente iguales, estados/fechas/importes; tiempos locales 906ms antes y 1053ms despues (SQL JSON/PGlite agrega costo; no se promete latencia de produccion). Fixture con latencia por consulta 35ms: unos 190ms antes vs 47ms batch; muestra reduccion de viajes, no rendimiento real. Permisos, sin sync Excel, una POST/no GET de recarga, tsc y build PASS. Produccion 200, POST anonima 401; no aprobaciones reales de prueba.
