# Acceso unificado (preparación local)

El acceso queda centralizado en Registros ATK: el usuario valida sus credenciales una vez y elige Registros ATK o Turnos ATK. La contraseña no se comparte con Turnos. Para el pase se emite un código aleatorio de un solo uso que vence a los dos minutos.

## Vista local

Ejecuta Registros ATK en el puerto 3001 y Turnos ATK en el puerto 3000, cada uno con su propia base local:

```powershell
# Registros ATK
npm run dev -- --port 3001

# Turnos ATK, en otra terminal
npm run dev -- --port 3000
```

Desde `http://localhost:3000`, el botón de acceso unificado abre el portal en `http://localhost:3001`. Después de elegir Turnos, el navegador vuelve al puerto 3000.

## Antes de probar el pase

La tabla `TurnosPortalGrant` se agrega con `prisma/migrations/20261102000000_turnos_portal_grants/migration.sql`. La migración está preparada pero no se aplicó a ninguna base de datos. Antes de usar el flujo, aplica esta migración **solo a una base local de desarrollo** y regenera Prisma Client:

```powershell
npx prisma migrate deploy
npx prisma generate
```

No ejecutes esos comandos si `DATABASE_URL` apunta a una base compartida o de producción.

## Variables para despliegue futuro

- Turnos ATK: `REGISTROS_ATK_URL` debe apuntar al dominio de Registros y `REGISTROS_ATK_SHARED_SECRET` debe coincidir con el valor configurado en Registros.
- Registros ATK: configurar `NEXT_PUBLIC_TURNOS_ATK_URL` con el dominio público de Turnos.
- Aplicar la migración en la base de Registros antes de publicar los dos proyectos.

Este cambio está preparado en los archivos locales; no se publicó ni se ejecutó ninguna migración de base de datos.
