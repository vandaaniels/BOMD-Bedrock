# Protocolo de prueba del Nether Gauntlet 1.4.0

## Preparación

1. Elimina del almacenamiento y del mundo los packs 1.3.0 anteriores.
2. Importa `BOMD_Bedrock_Public_Beta_1.4.0_Gauntlet_Combat_Rewrite.mcaddon`.
3. Activa Behavior Pack, Resource Pack y el experimento **Beta APIs**.
4. Usa dificultad Difícil o el perfil Java exacto.
5. Ejecuta `/scriptevent bomd:status` y confirma API `2.9.0-beta`.
6. Activa el registro con `/scriptevent bomd:debug record_start`.

## Prueba 1: estado inicial

1. Genera el jefe.
2. Debe permanecer con mano abierta, animación idle y sin desplazarse.
3. Un golpe válido en el ojo debe despertarlo sin mostrar un amago de puñetazo.
4. Debe esperar aproximadamente 80 ticks antes de seleccionar el primer movimiento.

## Prueba 2: compromiso de ataque

1. Mantente en Supervivencia entre 12 y 20 bloques.
2. Cuando el registro muestre `gauntlet_attack_selected`, observa el nombre del ataque.
3. Hasta `gauntlet_attack_start`, el nombre seleccionado no debe cambiar.
4. Golpea al jefe con un segundo jugador durante la preparación. El ataque no debe girar ni cambiar de objetivo a mitad de la secuencia.

## Prueba 3: puñetazo normal

1. Mantente en una zona despejada.
2. El jefe debe acercarse a aproximadamente 6–9 bloques antes de iniciar el puñetazo.
3. Debe mirar al jugador, elevarse, cerrar el puño y cargar hacia la posición fijada.
4. El jugador puede esquivarlo moviéndose después de que comience; el ataque no debe convertirse en misil guiado.
5. Después de fallar, la velocidad debe disiparse por el drag 0,85 y no cruzar toda la arena.

## Prueba 4: puñetazo giratorio

1. Reduce la salud por debajo de 70%.
2. El ataque debe prepararse a aproximadamente 6–8,5 bloques.
3. La animación `swirl_punch` no debe interrumpirse con idle o punch_start.
4. Debe conservar el estado energizado hasta el impacto o el tick 60.

## Prueba 5: variedad

1. Reduce la salud por debajo de 50%.
2. Registra al menos 12 selecciones.
3. Láser y giro no deben repetirse inmediatamente.
4. Ceguera no debe aparecer dos veces dentro de las últimas cuatro selecciones.
5. El puñetazo puede repetirse, como en Java.

## Prueba 6: controlador de animación

Durante cada acción, el Content Log y la imagen deben mostrar una secuencia continua:

- `punch_start → punch_loop → punch_stop → idle`
- `swirl_punch → idle`
- `laser_start → laser_loop → laser_stop → idle`
- `cast → idle`

No debe aparecer un fotograma mezclado de idle entre fases; todas las transiciones usan mezcla cero.

## Cierre

Ejecuta `/scriptevent bomd:debug record_stop` y conserva las líneas:

- `gauntlet_attack_selected`
- `gauntlet_attack_ready`
- `gauntlet_attack_start`
- `gauntlet_attack_end`
- `BOMD_METRICS`
