# Estrutura de dados

Armazenamento: **IndexedDB** `diario-recuperacao` (v1), um *object store* por tipo, todos com `keyPath: "id"`.
Datas/horas (`at`, `firstDoseAt`, `scheduledAt`…) são **epoch em milissegundos (UTC)**; a tela mostra tudo em
`America/Sao_Paulo`. `endDate` é texto `YYYY-MM-DD` (inclusive: vale até 24:00 desse dia, horário de São Paulo).
Registros de exemplo têm `sample: true`.

| Store | Campos principais |
|---|---|
| `patient` (id `main`) | `name`, `weightKg`, `accidentDate`, `injuries`, `vet{name,phone}`, `emergency{name,phone}`, `thresholds{}` (só o que difere do padrão) |
| `weights` | `at`, `kg` |
| `meds` | `name`, `strength`, `dose` (texto **como prescrito**), `route` (oral/colirio/topica/injetavel), `intervalH`, `firstDoseAt`, `endDate?`, `food` (sim/nao/indiferente), `notes`, `stockQty?`, `unitsPerDose?`, `stockAt`, `active`, `stoppedAt?` |
| `doseLogs` | `medId`, `scheduledAt` (null = dose extra), `at`, `status` (`given`/`skipped`/`vomited`), `by`, `note` |
| `water` | `at`, `offeredMl`, `leftMl` (ingerido = oferecido − sobra) |
| `food` | `at`, `type`, `portion` (tudo/3/4/1/2/1/4/recusou), `offeredG?`, `leftG?`, `notes` |
| `vomits` | `at`, `kind` (vomito/regurgitacao), `aspect`, `blood`, `notes` |
| `elims` | `at`, `kind` (urina/coco), `amount` (nada/pouco/medio/grande; `nada` = tentou e não saiu), `color`, `consistency`, `blood`, `notes` |
| `resps` | `at`, `rpm`, `state` (dormindo/repouso/esforco), `method` (`manual`/`auto`/`auto_corrigido`), `confidence` (alta/media/baixa), `autoRpm`, `manualRpm`, `rpmSpec`, `rpmPeaks`, `paired`, `durationS`, `breathsDetected`, `effort`, `mouthOpen`, `noisy`, `cough`, `gumAbnormal`, `soundTypes[]`, `audioId?`, `notes` |
| `signs` | `at`, `gum` (rosa/palida/branca/azulada/amarelada), `crt` (s), `pain` (0–4), `painSigns[]`, `belly` (normal/inchada/dura/inchada_dura), `woundDischarge/Smell/Swelling` (só existem se a ferida foi avaliada), `temp`, `seizure`, `collapse`, `photoId?`, `notes` |
| `photos` | `at`, `blob` (JPEG ≤ 1280 px), `note` |
| `audios` | `at`, `blob` (opus/webm ou mp4), `mime`, `durationS` |
| `settings` (id `main`) | `acks{alertId: ts}`, `by`, `calibrationDone`, `notify`, `notified{}` |

## Regras de interpretação

* **Agenda**: horários = `firstDoseAt + k × intervalH`, até o fim do tratamento/suspensão. Âncora fixa, então intervalos que viram o dia (8/8h às 22h, 5/5h…) funcionam.
* **Status da dose** (último registro vale): `pending` → `late` (> 30 min sem registro) / `given` / `skipped` / `vomited`. Duplicada = 2+ registros `given` no mesmo horário.
* **Medida de respiração conta** para tendência e alertas de frequência só se `state` ∈ {dormindo, repouso} e **não** for `method:auto` com `confidence:baixa` sem correção.
* **Estoque** = `stockQty − unitsPerDose × doses dadas desde stockAt`.
* **Backup JSON**: `{app, version, exportedAt, data:{<store>:[…]}}`; blobs viram data URLs.
* **CSV**: separador `;`, UTF-8 com BOM, colunas `tipo;data_hora;detalhe;valor;unidade`.

## Limites padrão (editáveis em Mais → Limites dos alertas)

rpm amarelo > 30 · vermelho > 40 · aumento ≥ 20% da média de 24h · dose atrasada 30 min · água 50–60 mL/kg/dia (alerta < 50% do mínimo, > 100 mL/kg) ·
sem urinar 24 h · sem comer 24 h · 2 recusas seguidas · TPC > 2 s · temperatura 37,5–39,2 °C · dor ≥ 3.
**São valores gerais de referência, não prescrição: o veterinário deve ajustá-los.**
