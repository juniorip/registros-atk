# Cambio de sedes — agosto de 2026

Esta carpeta es una versión local de trabajo. No modifica Vercel ni la base de datos por sí sola.

## Nueva estructura

| Sede | Jefa de sede | Colaboradores |
| --- | --- | --- |
| Miraflores | Valeria Alessandra | Benedic, Cristian Sulca y Camila |
| Lince | Danna | Ivon |

La sede antes llamada Centro ahora se muestra y opera como Lince; no se creó una sede adicional. Los datos históricos guardados como Centro siguen visibles para Lince. Cada jefa solo puede ver y aprobar los registros de su propia sede.

## Datos desde el 1 de agosto

El archivo `scripts/reassign-sedes-2026-08.mjs` reasigna, desde el 1 de agosto de 2026 (hora de Lima):

- usuarios, rol y sede;
- registros, referidos, tarjetas erradas, llamadas y tarjetas comerciales;
- códigos Safetypay según la persona que los creó;
- penalidades cuyo colaborador afectado pertenezca a una de estas sedes;
- calificaciones del asesor correspondiente.

No consulta ni modifica el Excel o los datos de asistencia.

## Aplicación posterior

1. Respaldar la base de datos de producción.
2. Configurar `DATABASE_URL` para apuntar a esa base.
3. Ejecutar primero la vista previa:

```bash
node scripts/reassign-sedes-2026-08.mjs
```

4. Revisar que cada nombre coincida exactamente una vez. Si hay 0 o más de una coincidencia, el script no hace cambios.
5. Aplicar la migración:

```bash
node scripts/reassign-sedes-2026-08.mjs --apply
```

Luego se debe desplegar esta misma carpeta en Vercel para que la separación de permisos de Lince y Miraflores entre en vigor.
