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
*(O Maven criará o arquivo POM necessário automaticamente).*

---

#### Métodos Alternativos via Scripts:

##### No Windows (PowerShell):
```powershell
# Criar pasta temporária
New-Item -ItemType Directory -Force -Path "$env:TEMP\ncp"

# Baixar o JAR oficial do NoCheatPlus
Invoke-WebRequest -Uri "https://github.com/Updated-NoCheatPlus/NoCheatPlus/releases/download/v1.5/NoCheatPlus.jar" -OutFile "$env:TEMP\ncp\NoCheatPlus.jar"

# Criar o arquivo POM mínimo
@'
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.github.Updated-NoCheatPlus.NoCheatPlus</groupId>
    <artifactId>nocheatplus</artifactId>
    <version>1.5</version>
    <packaging>jar</packaging>
</project>
'@ | Out-File -FilePath "$env:TEMP\ncp\ncp-clean-pom.xml" -Encoding utf8

# Instalar no repositório Maven local
mvn install:install-file -Dfile="$env:TEMP\ncp\NoCheatPlus.jar" -DpomFile="$env:TEMP\ncp\ncp-clean-pom.xml"
```

##### No Windows (CMD / Prompt de Comando automatizado):
```cmd
mkdir %TEMP%\ncp
curl -sL -o %TEMP%\ncp\NoCheatPlus.jar https://github.com/Updated-NoCheatPlus/NoCheatPlus/releases/download/v1.5/NoCheatPlus.jar
echo ^<project xmlns="http://maven.apache.org/POM/4.0.0"^>^<modelVersion^>4.0.0^</modelVersion^>^<groupId^>com.github.Updated-NoCheatPlus.NoCheatPlus^</groupId^>^<artifactId^>nocheatplus^</artifactId^>^<version^>1.5^</version^>^<packaging^>jar^</packaging^>^</project^> > %TEMP%\ncp\ncp-clean-pom.xml
mvn install:install-file -Dfile=%TEMP%\ncp\NoCheatPlus.jar -DpomFile=%TEMP%\ncp\ncp-clean-pom.xml
```

##### No Linux / macOS / WSL:
```bash
curl -sL -o /tmp/NoCheatPlus.jar https://github.com/Updated-NoCheatPlus/NoCheatPlus/releases/download/v1.5/NoCheatPlus.jar
printf '<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>com.github.Updated-NoCheatPlus.NoCheatPlus</groupId><artifactId>nocheatplus</artifactId><version>1.5</version><packaging>jar</packaging></project>' > /tmp/ncp-clean-pom.xml
mvn install:install-file -Dfile=/tmp/NoCheatPlus.jar -DpomFile=/tmp/ncp-clean-pom.xml
```


### Como Compilar
Com as dependências resolvidas e o JDK 25 configurado:

1. Abra o terminal no diretório raiz do Civs (`Civs-1.11.6`).
2. Execute o comando:
   ```bash
   mvn clean package -DskipTests
   ```
3. O JAR compilado e com as dependências integradas (shaded) será gerado em:
   `target/civs-1.11.7.jar`

### Executar Testes
Para rodar a suite de testes automatizados:
```bash
mvn test
```
*(Nota: O teste `RegionsTests.dailyRegionShouldUpkeepDaily` pode falhar de forma intermitente quando a suite completa é executada devido ao estado compartilhado do gerenciador de regiões. O teste passa de forma consistente quando rodado de forma isolada com `mvn test -Dtest=RegionsTests`.)*

---

## WARNING: Civs is a Work in Progress project! 
Its not ready yet, so please report any bug you find and help us improve and make this dream project come true!
Thanks for reading!

