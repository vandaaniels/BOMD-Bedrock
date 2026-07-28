# Localizador de la Estrella de almas — 1.5.4

## Comportamiento

1. Busca una Torre del Night Lich cargada y no derrotada.
2. Busca una ubicación persistente previamente registrada, aunque su chunk esté descargado.
3. Busca una torre creada antes por el plan determinista.
4. Si no existe ninguna, genera candidatos reproducibles a partir de la semilla del mundo.
5. Carga temporalmente un área de 3 × 3 chunks alrededor de cada candidato.
6. Exige un bioma frío o congelado, evita océanos y líquidos, comprueba una pendiente máxima de cuatro bloques y verifica que la estructura completa quepa en la dimensión.
7. Coloca la torre, crea el ancla y registra su ubicación.
8. Consume y devuelve la Estrella de almas únicamente después de resolver un destino real.

## Persistencia

- Registro general: `bomd:structure_registry_v1`.
- Plan determinista: `bomd:night_lich_locator_v1`.
- Estados del plan: `rejected`, `generated` y `defeated`.

## Restricciones

- La torre se localiza desde el Overworld.
- La primera búsqueda puede tardar unos segundos si necesita comprobar varios candidatos.
- Las áreas temporales se eliminan siempre después de cada comprobación.
- El sistema conserva la generación natural por `feature_rules`; el plan determinista actúa únicamente como respaldo cuando no hay una torre válida conocida.


## Corrección 1.5.4

Las búsquedas remotas ya no envían candidatos X/Z incompletos como un `Vector3`. Si la altura aún no se conoce, los anchors cargados se filtran horizontalmente en JavaScript; la altura completa se usa solo cuando ya está disponible.
