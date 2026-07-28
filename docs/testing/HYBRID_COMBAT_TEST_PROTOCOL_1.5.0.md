# Protocolo de prueba híbrida — 1.5.0

## Preparación

1. Elimina del almacenamiento y del mundo las versiones anteriores del Behavior Pack y Resource Pack.
2. Importa `BOMD_Bedrock_Public_Beta_1.5.0_Hybrid_Engine_Refactor.mcaddon`.
3. Activa ambos packs.
4. Activa **Experimentos > API beta**.
5. Habilita el Content Log.
6. Ejecuta `/scriptevent bomd:status`.

La respuesta debe identificar scripts 1.5.0 y `@minecraft/server 2.9.0-beta`.

## Nether Gauntlet

1. Usa `/function bomd/nether_gauntlet/build_arena` o `/function bomd/nether_gauntlet/spawn`.
2. En Supervivencia, golpea el ojo abierto.
3. Registra el combate con:
   - `/scriptevent bomd:debug record_start`
   - `/scriptevent bomd:debug record_stop`
4. Baja la vida por debajo de 85 %, 70 % y 50 % para habilitar todos los ataques.

### Resultado esperado

- Puñetazo: pulsos `begin`, `clink`, `impulse_1`, `impulse_2`, `impulse_3`, `open`, `complete`.
- Giro: `begin`, `impulse_1`, `impulse_2`, `open`, `complete`.
- Láser: `begin`, `active`, `recovery`, `complete`.
- Oscuridad: `begin`, `burst`, `apply`, `complete`.
- La caja física cambia a 2 × 2 durante los ticks 7–63 del puñetazo, 7–59 del giro y 10–42 de oscuridad; fuera de esas ventanas vuelve a 2 × 4.
- No debe existir daño duplicado por un mismo pulso.
- El final normal debe registrar `behavior_timeline_complete`.
- `timeline_watchdog` no debe aparecer.

## Night Lich

1. Usa `/function bomd/night_lich/build_tower` para la prueba completa o `/function bomd/night_lich/spawn` para una prueba aislada.
2. Entra en Supervivencia o Aventura.
3. Observa al menos un cometa, una ráfaga de misiles, una invocación y un teletransporte.
4. Reduce su vida para activar las secuencias rage.

### Resultado esperado

- Cometa: preparación, quince telegraphs, un lanzamiento y finalización.
- Misiles: preparación, ocho telegraphs, una ráfaga y finalización.
- Phantoms: runas, materialización y finalización.
- Teletransporte: diez partículas previas, desaparición, movimiento bloqueado al destino inicial, diez partículas posteriores y finalización.
- Rage: cada subataque debe emitir una única secuencia ordenada.
- No debe aparecer un fotograma de idle artificial entre estados de teleport.
- No deben coexistir dos ataques activos.
- `timeline_watchdog` no debe aparecer.

## Registro útil

Buscar en el Content Log:

```text
[BOMD_COMPARE] ... gauntlet_timeline_pulse
[BOMD_COMPARE] ... lich_timeline_pulse
[BOMD_COMPARE] ... behavior_timeline_complete
```

Reportar cualquier entrada `timeline_stale`, `timeline_watchdog`, excepción de propiedad, evento desconocido o pulso duplicado, junto con unos veinte segundos de registro antes y después del fallo.
