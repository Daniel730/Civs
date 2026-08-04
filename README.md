## Civs - Complete RPG Plugin

**What is Civs?** Civs is a comprehensive, highly configurable RPG mechanics plugin. Mainly focused on Land Management via Towns and Regions. Also includes a robust class system.

---
**Installation:** Civs has a pre-configured version which is distributed by our team. It's ready to plug-and-play and also comes with a variety of custom regions, classes and skills. For a starting server, the default settings are enough to give an idea of how this plugin works. If you have any questions, first, check our wiki and if you don't find the answer, just open a ticket on our GitHub. Wiki Link: https://github.com/Multitallented/Civs/wiki

---
**Permissions:**
| Permission                      | Type          | Description |
| ------------------------------- |:-------------:| ----------- |
| **civs.admin**                  | Admin Only    | Allows full control over Civs. Bypass and Admin features. | 
| **civs.join**                   | Default True  | Allows the player to join a town.                         | 
| **civs.choose**                 | Default True  | Class Selection permission. Currently does nothing.       |
| **civs.shop**                   | Default True  | Needed to buy Civ items in the Shop Menu.                 |
| **civs.create.admin_graveyard** | Custom        | Custom permission, allows you to buy an admin_graveyard. You can check this custom setup on: 'item-types/admin-invisible/admin_graveyard.yml' |
| **my.civs.build.windmill**      | Custom        | This is a custom permission node, you can define it as a prerequisite for a custom build.           |---
---
**Commands**
* /cv - opens the menu
* /cv town <town name> - creates a town using the town type block you are holding at the location you are standing
* /cv invite <player> <town name> - invite a player to your town
* /cv toggleann - toggles on/off the periodic hints in chat
* /cv accept - Accepts a town invite
* /cv bounty <player|town name> <amount> - Sets a bounty on a player or town
* /cv newday - Runs a new day cycle (civs.admin permission required)
* /cv really <old name> <new name> - Renames an alliance
* /cv reload - Reloads Civs (civs.admin permission required)
* /cv advancetut <player name> - Advances the player one step further on their current tutorial path.
* /cv rename <old name> <new name> - Renames a town
* /cv reset <player name> - Deletes all regions and removes all player data for that player (civs.admin permission required)
* /cv sell <amount> - Sells the region you are standing in (only works on sellable regions ie: housing)
* /cv tax <town name> <amount> - Sets the daily tax for the town (only available to certain government types)
* /cv withdraw <amount> - Withdraws money from the town bank (only available to town owners)
---
**Team & Support:** We offer support via GitHub, but if you need to contact us directly, we also have a Discord Channel which you can join by clicking in  the link below, also here is the list of current team members:
 * Multitallented - Developer (Discord: N/A)
 * Clockworker - Documenter (Discord: Clockworker#3819)

Discord Link: [KDqVjdx](https://discord.gg/KDqVjdx)

---

**Official Server:** We're currently working on building an official test server for players and admins to test our plugin. If you wish to join our test server, feel free to join our discord, we'll be releasing more updates soon!

## Compilação e Build

Para compilar o Civs localmente a partir do código-fonte, siga as instruções abaixo:

### Pré-requisitos
1. **Java JDK 25**: O projeto utiliza recursos do Java 25. Recomendamos instalar o **Eclipse Temurin JDK 25**.
   - Garanta que a variável de ambiente `JAVA_HOME` aponte para o JDK 25.
   - Adicione o JDK ao `PATH` do sistema.
2. **Apache Maven 3.9.x**: O projeto gerencia as dependências com Maven.
   - Adicione o executável do Maven (`mvn` ou `mvn.cmd`) ao `PATH` do sistema.

### Dependências com Problemas (JitPack Bug)
O Civs possui uma dependência do **NoCheatPlus** que é baixada via JitPack (`com.github.Updated-NoCheatPlus.NoCheatPlus:nocheatplus:1.5`). Devido a um problema no repositório JitPack, essa dependência pode retornar erro `404 Not Found` ao tentar compilar.

Para resolver isso de forma simples e 100% garantida (especialmente no Windows sem WSL ou onde o PowerShell/scripts estejam restritos):

#### Método Manual Recomendado (Qualquer OS / Windows CMD):
1. Baixe o arquivo JAR oficial do NoCheatPlus clicando no link a seguir pelo seu navegador:
   👉 [NoCheatPlus.jar (v1.5)](https://github.com/Updated-NoCheatPlus/NoCheatPlus/releases/download/v1.5/NoCheatPlus.jar)
2. Salve o arquivo com o nome `NoCheatPlus.jar` na pasta raiz do projeto `Civs-1.11.6`.
3. Abra o **Prompt de Comando (CMD)** ou terminal na pasta raiz do projeto e execute:
   ```cmd
   mvn install:install-file -Dfile=NoCheatPlus.jar -DgroupId=com.github.Updated-NoCheatPlus.NoCheatPlus -DartifactId=nocheatplus -Dversion=1.5 -Dpackaging=jar
   ```
*(O Maven criará o arquivo POM necessário automaticamente.)*

**Alternativa Linux / macOS / WSL (sem navegador, tudo pelo terminal):**
```bash
curl -sL -o /tmp/NoCheatPlus.jar https://github.com/Updated-NoCheatPlus/NoCheatPlus/releases/download/v1.5/NoCheatPlus.jar
printf '<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>com.github.Updated-NoCheatPlus.NoCheatPlus</groupId><artifactId>nocheatplus</artifactId><version>1.5</version><packaging>jar</packaging></project>' > /tmp/ncp-clean-pom.xml
mvn install:install-file -Dfile=/tmp/NoCheatPlus.jar -DpomFile=/tmp/ncp-clean-pom.xml
```

> Você só precisa fazer isso **uma vez** por máquina — o JAR fica no seu repositório Maven local (`~/.m2`).


### Como Compilar
Com as dependências resolvidas e o JDK 25 configurado:

1. Abra o terminal na pasta raiz do projeto (a pasta que contém o `pom.xml`).
   Se você baixou um release, essa pasta pode se chamar `Civs-1.11.6`; se clonou o
   repositório, ela se chama `Civs`. O nome da pasta não importa para compilar — mas
   veja a nota abaixo se você também for compilar o RPG complementar.
2. Execute:
   ```bash
   mvn clean package -DskipTests
   ```
3. O JAR final (shaded, com as dependências embutidas) é gerado em
   `target/civs-<versão>.jar` — atualmente `target/civs-1.11.7.jar`. A versão vem do
   `<version>` no `pom.xml`, então confira lá se este número mudar.

### Executar Testes
Para rodar a suíte de testes automatizados:
```bash
mvn test          # suíte completa
mvn test -Dtest=RegionsTests   # apenas uma classe
```
*(Nota: o teste `RegionsTests.dailyRegionShouldUpkeepDaily` pode falhar de forma
intermitente **apenas** quando a suíte completa roda, por causa de estado compartilhado
entre os gerenciadores singletons. Ele passa de forma consistente isolado com
`mvn test -Dtest=RegionsTests`. Não é um bug do seu ambiente.)*

---

## Rodar em um servidor Paper (ambiente de teste)

Compilar gera o JAR, mas para **ver o plugin funcionando** você precisa carregá-lo em um
servidor Paper. Passo a passo mínimo, do zero:

1. **Servidor:** baixe o **Paper 26.1.2** (mesma versão-alvo do `pom.xml`). A API v2 antiga
   do PaperMC foi descontinuada; use a API v3 "fill" para obter o link do JAR:
   ```bash
   curl -s https://fill.papermc.io/v3/projects/paper/versions/26.1.2/builds/72 \
     | grep -o 'https://[^"]*paper-26.1.2-72.jar' | head -1   # -> URL do download
   ```
2. **Dependências obrigatórias/recomendadas** (coloque os JARs em `plugins/`):
   - **Vault** (obrigatório — Civs depende dele para economia): baixe o release de
     `MilkBowl/Vault`.
   - **Um provedor de economia** (ex.: EssentialsX) — sem ele, `Civs.econ` fica nulo e
     compras de loja/região/cidade, impostos e recompensas não funcionam. Para testes,
     qualquer plugin que registre um `Economy` no Vault serve.
   - **Civs** (o JAR que você compilou).
3. **Configuração:** aceite a EULA (`eula.txt` com `eula=true`) e, para testes locais,
   use `online-mode=false` no `server.properties`.
4. **Suba o servidor:** `java -Xmx2G -jar paper.jar --nogui`. No log você deve ver
   `Civs Version: 1.11.7 is now enabled!` e `Hooked into Economy plugin: ...`.
5. **Config de produção (opcional):** o pacote `Civs_servidor/` contém a configuração
   completa (menus, item-types, cidades, regiões, traduções). Copie o conteúdo dele para
   `plugins/Civs/` para carregar tudo. Regiões/cidades salvas apontam para um UUID de
   mundo específico, então em um mundo novo você verá erros esperados de `Null world` /
   "invalid region" — o Civs ignora essas entradas com segurança.
6. **Teste no jogo:** entre com um cliente, use `/cv` para abrir o menu. Comandos de
   admin úteis para QA (OP ou `civs.admin`): `/cv give <player> <itemType> [qty]` e
   `/cv placeregion <player> <regionType> [x y z]` para receber itens e posicionar
   estruturas sem depender do mouse.

> Dica: `/cv reload` recarrega apenas a **configuração** do Civs, não o JAR. Ao trocar o
> JAR (código Java), **reinicie o servidor** para as mudanças valerem.

## RPG complementar (civs-quests)

Existe um plugin complementar que adiciona uma camada de RPG/quests por cima do Civs:
[`Daniel730/civs-quests`](https://github.com/Daniel730/civs-quests) (plugin `RPGServer`).
Ele **depende do JAR do Civs** (dependência Maven de escopo `system`) e escuta eventos do
Civs (ex.: `RegionCreatedEvent`) para progredir quests. Se você for compilar os dois:

- O `pom.xml` do `civs-quests` espera o JAR do Civs em
  `../Civs-1.11.6/target/civs-<versão>.jar` (pastas **lado a lado**, com a do Civs chamada
  `Civs-1.11.6`). Compile o Civs **primeiro**, depois o `civs-quests`.
- No servidor de teste, coloque `Civs.jar` **e** `RPGServer.jar` juntos em `plugins/`.

## Estrutura do código (visão geral)

Civs é um **único módulo Maven** que gera um JAR de plugin Bukkit/Paper. Pontos de
entrada e organização:

```
src/main/java/org/redcastlemedia/multitallented/civs/
├── Civs.java            # classe principal do plugin (onEnable, hooks, logger)
├── items/               # ItemManager + tipos de item (CivItem, RegionType, ClassType...)
├── regions/             # Region, RegionType, RegionManager, effects/* (estruturas)
├── towns/               # Town, TownManager, governos
├── menus/               # CustomMenu + telas @CivsMenu; YAML das telas em menus/
├── commands/            # comandos @CivsCommand (ex.: GiveCommand, PlaceRegionCommand)
├── civclass/            # sistema de classes (ClassManager, ClassType) e mana
├── spells/ · skills/    # magias e skills
├── scheduler/           # tarefas periódicas (upkeep de regiões, mana, etc.)
└── localization/        # traduções
```

Conceitos-chave:
- **Estruturas = "region types"**: cada estrutura é um `type: region` em
  `Civs_servidor/item-types/**` (174 no total). Ver `docs/STRUCTURE-TEST-REPORT.md`.
- **Identidade de região** é a localização (`worldUuid~x~y~z`), não o nome exibido.
- **Sem NMS**: apenas API do Paper + hooks opcionais (Vault, WorldEdit/FAWE, Dynmap).
- **Config autoritativa** fica em `Civs_servidor/` (a pasta `Civs/` é o pacote-bundle
  padrão). Menus são roteados pelo nome interno do menu, não pelo título exibido.
- Para orientações de desenvolvimento no ambiente de nuvem, veja `AGENTS.md`.

---

## WARNING: Civs is a Work in Progress project! 
Its not ready yet, so please report any bug you find and help us improve and make this dream project come true!
Thanks for reading!

