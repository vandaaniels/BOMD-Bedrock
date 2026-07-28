# Protocolo de comparación de movimiento — BOMD Bedrock 1.2.6

Este protocolo evita afirmar equivalencia con Java sin mediciones dentro de Bedrock.

## Registro agregado

1. Activa el Content Log de Minecraft Bedrock.
2. Inicia una pelea en una arena despejada y ejecuta:

   `/scriptevent bomd:debug record_start`

3. Mantén el combate durante al menos 1.800 ticks (90 segundos). No vueles en creativo y evita cambiar de dimensión.
4. Detén el registro:

   `/scriptevent bomd:debug record_stop`

5. Busca líneas con el prefijo `[BOMD_METRICS]` en el Content Log.

Cada resumen incluye velocidad media y máxima, distancia media/mínima/máxima al objetivo, porcentaje dentro del rango previsto, porcentaje inmóvil, movimiento vertical, cambios de dirección, episodios de bloqueo y tiempo de retorno al rango.

## Comparación recomendada

Repite la prueba tres veces por jefe bajo las mismas condiciones. Compara:

- Nether Gauntlet: rango previsto de 5 a 25 bloques.
- Night Lich: rango previsto de 15 a 30 bloques.
- Porcentaje inmóvil y bloqueado.
- Tiempo para regresar al rango después de alejarte.
- Velocidad media y frecuencia de cambios bruscos de dirección.

## OBB del Nether Gauntlet

Activa:

`/scriptevent bomd:debug gauntlet_hitboxes`

Con el jefe mirando horizontalmente, la caja del ojo debe coincidir con el ojo visual y quedar centrada aproximadamente en `Y de la entidad + 1.65`. Repite la inspección con yaw y pitch positivos y negativos.


## Campos añadidos en 1.2.6

- `attackTick`: tick local del ataque activo.
- `ambientFlightSuppressed`: indica si el controlador ambiental se encuentra suspendido durante la ventana física de carga.

Para el puñetazo normal, la supresión debe ser verdadera únicamente entre los ticks 16 y 55. Para el giro, entre 30 y 59.
