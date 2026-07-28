# Arquitectura híbrida del combate — 1.5.0

## Fuente de verdad

La propiedad de entidad `bomd:server_attack` representa la acción física activa:

### Nether Gauntlet

| Valor | Acción |
|---:|---|
| 0 | Reposo / reposicionamiento |
| 1 | Puñetazo |
| 2 | Puñetazo giratorio |
| 3 | Láser |
| 4 | Oscuridad |

### Night Lich

| Valor | Acción |
|---:|---|
| 0 | Reposo |
| 1 | Misiles |
| 2 | Cometa |
| 3 | Phantoms |
| 4 | Teletransporte |
| 5 | Rage: cometas |
| 6 | Rage: misiles |
| 7 | Rage: phantoms |

JavaScript únicamente selecciona la acción y establece esta propiedad. El controlador del paquete de comportamientos entra al estado correspondiente y reproduce una animación de servidor no repetitiva.

## Flujo de un ataque

1. El administrador JavaScript valida objetivo, distancia, fase y memoria.
2. El módulo del ataque prepara datos inmutables: destino, dirección, posiciones o historial.
3. JavaScript establece `bomd:server_attack`.
4. El controlador de comportamiento entra al estado del ataque.
5. La animación de comportamiento ejecuta eventos de entidad para colisión y propiedades visuales.
6. La misma línea temporal emite `/scriptevent` para cálculos que requieren JavaScript.
7. El puente valida entidad y ataque activo antes de entregar el pulso.
8. El evento `complete` devuelve la propiedad a cero y libera el ataque.
9. Un watchdog de duración más veinte ticks solo interviene si la línea temporal no finaliza.

## Separación de responsabilidades

### Motor declarativo de Bedrock

- Estados persistentes del ataque.
- Cronología exacta.
- Component groups.
- Caja física abierta/cerrada.
- Propiedades del ojo y material.
- Propiedades usadas por el controlador visual.
- Eventos de inicio, transición, recuperación y finalización.

### JavaScript

- Matemática tridimensional.
- Memoria de daño y selección ponderada.
- Navegación validada.
- OBB y colisión barrida.
- Raycasts y exposición de explosiones.
- Proyectiles y entidades auxiliares.
- Teletransporte seguro.
- Multijugador.
- Muerte, experiencia, loot y persistencia.

## Sincronización con el paquete de recursos

Los eventos del paquete de comportamientos modifican:

- `bomd:animation_state`
- `bomd:visual_state`
- `bomd:eye_open`
- `bomd:casting`

Los controladores del paquete de recursos leen esas propiedades. Por tanto, la cronología física y la representación visual derivan del mismo evento de servidor, en lugar de usar dos temporizadores independientes.

## Protección contra duplicados

Los módulos de ataque ya no programan `system.runTimeout` ni comparan ticks para hitos discretos. Los pulsos se descartan cuando:

- La entidad ya no es válida.
- El tipo de entidad no coincide.
- El ataque del mensaje no coincide con `state.currentAttack`.
- El contexto fue invalidado por muerte, pérdida del objetivo o cancelación.

## Recuperación ante fallos

Si una línea temporal no emite `complete`, el watchdog cierra el ataque después de `duration + 20` ticks. Esto evita bloqueos permanentes, pero su aparición en el Content Log indica un error que debe investigarse.
