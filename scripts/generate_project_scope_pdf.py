#!/usr/bin/env python3
"""Generates docs/PROJECT-SCOPE.pdf — bilingual (PT/EN) scope document for the
Civs + RPGServer plugin ecosystem. Regenerate after major scope changes:

    py scripts/generate_project_scope_pdf.py
"""
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

OUT_PATH = Path(__file__).resolve().parent.parent / "docs" / "PROJECT-SCOPE.pdf"

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="CoverTitle", fontSize=26, leading=32, alignment=TA_CENTER,
                           textColor=colors.HexColor("#2b2118"), spaceAfter=12, fontName="Helvetica-Bold"))
styles.add(ParagraphStyle(name="CoverSubtitle", fontSize=14, leading=18, alignment=TA_CENTER,
                           textColor=colors.HexColor("#5a4a35"), spaceAfter=6))
styles.add(ParagraphStyle(name="H1", fontSize=18, leading=22, spaceBefore=18, spaceAfter=10,
                           textColor=colors.HexColor("#2b2118"), fontName="Helvetica-Bold"))
styles.add(ParagraphStyle(name="H2", fontSize=13, leading=16, spaceBefore=12, spaceAfter=6,
                           textColor=colors.HexColor("#5a4a35"), fontName="Helvetica-Bold"))
styles.add(ParagraphStyle(name="Body", fontSize=10.5, leading=15, spaceAfter=6))
styles.add(ParagraphStyle(name="BodyEn", fontSize=9.5, leading=13, spaceAfter=8,
                           textColor=colors.HexColor("#555555"), fontName="Helvetica-Oblique"))
styles.add(ParagraphStyle(name="ScopeBullet", fontSize=10.5, leading=14))

TABLE_HEADER_BG = colors.HexColor("#3a2f22")
TABLE_ROW_BG = colors.HexColor("#f4efe6")


def pt_en(pt: str, en: str):
    return [Paragraph(pt, styles["Body"]), Paragraph(en, styles["BodyEn"])]


def bullets(items, style="ScopeBullet"):
    return ListFlowable(
        [ListItem(Paragraph(item, styles[style]), leftIndent=12) for item in items],
        bulletType="bullet",
        start="•",
        spaceBefore=2,
        spaceAfter=8,
    )


def make_table(header, rows, col_widths=None):
    data = [header] + rows
    table = Table(data, colWidths=col_widths, repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEADER_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, TABLE_ROW_BG]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#c9bfa8")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return table


def build_story():
    story = []

    # Cover
    story.append(Spacer(1, 5 * cm))
    story.append(Paragraph("Civs + RPGServer", styles["CoverTitle"]))
    story.append(Paragraph("Documento de Escopo do Projeto", styles["CoverTitle"]))
    story.append(Spacer(1, 0.5 * cm))
    story.append(Paragraph("Project Scope Document", styles["CoverSubtitle"]))
    story.append(Spacer(1, 1.5 * cm))
    story.append(Paragraph(
        "Um servidor de sobrevivência medieval-fantasia com cidades construídas pelos jogadores, "
        "monstros customizados, missões narrativas e progressão de personagem — inspirado em "
        "The Elder Scrolls V: Skyrim, Valheim e Enshrouded.", styles["CoverSubtitle"]))
    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph(
        "A medieval-fantasy survival server with player-built towns, custom monsters, "
        "narrative quests and character progression — inspired by Skyrim, Valheim and Enshrouded.",
        styles["CoverSubtitle"]))
    story.append(Spacer(1, 3 * cm))
    story.append(Paragraph("Daniel730 · Civs 1.11.6 (Paper 26.1.2 / Java 25) · RPGServer 0.1.0-SNAPSHOT",
                            styles["CoverSubtitle"]))
    story.append(PageBreak())

    # 1. Vision
    story.append(Paragraph("1. Visão do Projeto / Project Vision", styles["H1"]))
    story.extend(pt_en(
        "O servidor combina a construção de território e economia de Civs com uma camada de RPG "
        "(RPGServer) que adiciona missões, arquétipos, progressão e recompensas — buscando a sensação "
        "de mundo vivo de três referências principais:",
        "The server combines Civs' territory-building and economy with an RPG layer (RPGServer) "
        "that adds quests, archetypes, progression and rewards — chasing the 'living world' feeling "
        "of three main references:"))
    story.append(bullets([
        "<b>Skyrim</b> — Trilhas de personagem (Guerreiro, Construtor, Mercador), árvore de perks "
        "estilo constelação, missões com escolhas e um códice de descobertas (Codex).",
        "<b>Valheim</b> — Progressão por biomas/exploração, construção cooperativa de bases (cidades), "
        "caçadas a monstros temáticos como marco de progresso.",
        "<b>Enshrouded</b> — Vilas que crescem organicamente com o jogador, NPCs e estruturas "
        "utilitárias (sala do conselho, muralhas, guildas) desbloqueando novas mecânicas.",
    ]))
    story.extend(pt_en(
        "O objetivo de design é que <b>Civs</b> seja o \"mundo\" (território, construção, economia, "
        "mobs, defesa) e o <b>RPGServer</b> seja a \"narrativa e progressão\" (missões, arquétipos, "
        "perks, recompensas) — nunca duplicando responsabilidades.",
        "Design goal: <b>Civs</b> is the \"world\" (territory, building, economy, mobs, defense) and "
        "<b>RPGServer</b> is \"narrative and progression\" (quests, archetypes, perks, rewards) — "
        "responsibilities are never duplicated."))

    # 2. Core loops
    story.append(Paragraph("2. Loops Centrais de Jogo / Core Gameplay Loops", styles["H1"]))
    story.append(Paragraph("2.1 Loop territorial (Civs)", styles["H2"]))
    story.extend(pt_en(
        "Explorar → fundar/entrar em uma cidade → construir regiões (casas, fazendas, lojas, defesa, "
        "sala do conselho) → gerenciar upkeep e banco da cidade → evoluir a cidade (hamlet → vila → "
        "cidade → metrópole) → defender contra mobs customizados e outros jogadores.",
        "Explore → found/join a town → build regions (housing, farms, shops, defense, council room) → "
        "manage upkeep and town bank → evolve the town (hamlet → village → town → metropolis) → "
        "defend against custom mobs and rival players."))
    story.append(Paragraph("2.2 Loop de progressão (RPGServer)", styles["H2"]))
    story.extend(pt_en(
        "Abrir o Hub do Jogador → escolher um arquétipo (Guerreiro/Construtor/Mercador) → aceitar e "
        "rastrear missões (diárias, semanais, de trilha) → cumprir objetivos via ações no mundo Civs "
        "→ receber recompensas (dinheiro, XP, perks, itens) → desbloquear a árvore de habilidades e, "
        "no topo, o Renascimento (rebirth).",
        "Open the Player Hub → choose an archetype (Warrior/Builder/Merchant) → accept and track "
        "quests (daily, weekly, path) → complete objectives via actions in the Civs world → receive "
        "rewards (money, XP, perks, items) → unlock the skill tree and, at the top, Rebirth."))
    story.append(Paragraph("2.3 Loop de combate e caçada", styles["H2"]))
    story.extend(pt_en(
        "Missões de caçada invocam um monstro customizado próximo ao aceitar a missão "
        "(<i>spawnForQuest</i>), com um raio de grupo (\"partyRadius\") que credita o abate ao dono "
        "da missão mesmo que um aliado próximo desfira o golpe final — incentivando caçadas em grupo.",
        "Hunt quests spawn a custom mob near the player on accept (spawnForQuest), with a party "
        "radius that credits the kill to the quest owner even if a nearby ally lands the final blow — "
        "encouraging group hunts."))

    # 3. Responsibilities
    story.append(Paragraph("3. Civs vs RPGServer — Responsabilidades / Responsibilities", styles["H1"]))
    story.extend(pt_en(
        "Regra de ouro: nunca duplicar. Civs é a fonte da verdade para o mundo; RPGServer nunca "
        "guarda XP de skill, nunca cria seu próprio shop nativo, e apenas orquestra através de "
        "eventos e hooks.",
        "Golden rule: never duplicate. Civs is the source of truth for the world; RPGServer never "
        "stores skill XP, never builds its own native shop, and only orchestrates via events and hooks."))
    story.append(make_table(
        ["Domínio / Domain", "Civs", "RPGServer"],
        [
            ["Território / cidades", "Dono — regiões, upkeep, banco, defesa", "Consome eventos (build_region, join_town)"],
            ["Economia", "Banco da cidade, taxas, leilão (BIN)", "Vault: recompensas, earn_money, balance_min"],
            ["Skills", "Skills internas (mineração, construção…)", "AuraSkills: XP de combate/exploração/etc."],
            ["Mobs customizados", "YAML, spawn, CustomMobKillEvent, crédito de grupo", "Escuta CustomMobKillEvent para quest kills"],
            ["Missões / narrativa", "—", "Dono — QuestManager, objetivos, recompensas"],
            ["Progressão de personagem", "—", "Arquétipos, árvore de perks, rebirth"],
            ["Permissões / trilhas", "—", "LuckPerms: rpg.quest.<id>, grupos de trilha"],
            ["Interface (GUI)", "CustomMenu (cidades, lojas, regiões)", "Player Hub, Diário, Árvore de Skills, Codex"],
        ],
        col_widths=[4.3 * cm, 5.8 * cm, 6.4 * cm],
    ))

    # 4. Towns & regions
    story.append(PageBreak())
    story.append(Paragraph("4. Cidades e Regiões / Towns &amp; Regions", styles["H1"]))
    story.extend(pt_en(
        "Cidades evoluem de <b>hamlet</b> → <b>vila</b> → <b>cidade</b> → <b>metrópole</b>, cada nível "
        "desbloqueando novos tipos de região e maior capacidade de moradia/população. Regiões incluem "
        "moradia, fazendas, lojas, defesa (torretas, escudos) e utilidades (sala do conselho, prefeitura).",
        "Towns evolve from <b>hamlet</b> → <b>village</b> → <b>town</b> → <b>metropolis</b>, each tier "
        "unlocking new region types and higher housing/population caps. Regions include housing, farms, "
        "shops, defense (turrets, shields) and utilities (council room, town hall)."))
    story.append(Paragraph("Sala do Conselho (council_room)", styles["H2"]))
    story.extend(pt_en(
        "Edifício central de utilidade que fornece porto/teleporte da cidade e serve como marco de "
        "descoberta para missões RPG (<i>discover_poi: council_village</i>). Recebeu um efeito de "
        "monstro customizado (<i>custom_mob:guild_thief</i>) para dar vida ao prédio — assim como "
        "acampamentos de bandidos, salas do conselho já construídas precisam ser reconstruídas para "
        "herdar o novo efeito, pois o Civs clona os efeitos apenas na criação da região.",
        "Central utility building that provides the town's port/teleport and acts as a discovery "
        "landmark for RPG quests (discover_poi: council_village). It now has a custom mob spawn effect "
        "(custom_mob:guild_thief) to bring the building to life — like bandit camps, already-built "
        "council rooms must be rebuilt to inherit the new effect, since Civs only clones effects on "
        "region creation."))
    story.append(Paragraph("Defesa: torretas e escudos", styles["H2"]))
    story.extend(pt_en(
        "Torretas de flecha e dano, além de escudos de energia (power_shield) protegem cidades contra "
        "mobs hostis e invasores, com upkeep de recursos (ferro, flechas) e feedback visual/sonoro "
        "quando absorvem dano.",
        "Arrow/damage turrets and power shields protect towns from hostile mobs and invaders, with "
        "resource upkeep (iron, arrows) and visual/audio feedback on damage absorption."))

    # 5. Custom mobs
    story.append(Paragraph("5. Monstros Customizados / Custom Mobs", styles["H1"]))
    story.extend(pt_en(
        "Sistema em YAML (<i>plugins/Civs/mobs/*.yml</i>) define tipo de entidade base, vida, dano, "
        "drops e tempo de despawn. Cada monstro invocado recebe uma tag PDC "
        "(<i>civs:custom_mob_id</i>) e dispara <i>CustomMobKillEvent</i> ao morrer.",
        "YAML-driven system (plugins/Civs/mobs/*.yml) defines base entity type, health, damage, drops "
        "and despawn time. Each spawned mob gets a PDC tag (civs:custom_mob_id) and fires "
        "CustomMobKillEvent on death."))
    story.append(make_table(
        ["ID", "Base", "Tema / Theme"],
        [
            ["bandit_chief", "Pillager", "Chefe de bandidos — acampamentos"],
            ["bandit_scout", "Pillager", "Batedor — acampamentos, patrulhas"],
            ["wild_boar", "Pig variant", "Javali selvagem — caça neutra"],
            ["frost_wraith", "—", "Caçada de guerreiro — torre gelada"],
            ["sand_raider", "—", "Caçada — caravana afundada / deserto"],
            ["stone_golem", "—", "Caçada — profundezas da pedreira"],
            ["guild_thief", "Vindicator", "Ladrão — sala do conselho (novo)"],
        ],
        col_widths=[3.6 * cm, 3.6 * cm, 9.3 * cm],
    ))
    story.extend(pt_en(
        "Missões de caçada usam <i>spawnForQuest(mobId, local, donoDaMissão, partyRadius)</i> para "
        "gravar o dono da missão no monstro invocado; ao morrer, o Civs credita o abate ao dono se um "
        "aliado próximo (dentro do raio) desferir o golpe — o RPGServer lê "
        "<i>CustomMobKillEvent.getCreditedPlayer()</i> (com fallback para o abatedor) para progredir "
        "a missão corretamente.",
        "Hunt quests use spawnForQuest(mobId, location, questOwner, partyRadius) to tag the quest "
        "owner on the spawned mob; on death, Civs credits the kill to the owner if a nearby ally "
        "(within radius) lands the blow — RPGServer reads CustomMobKillEvent.getCreditedPlayer() "
        "(falling back to the killer) to progress the quest correctly."))

    # 6. NPC quests / questlines
    story.append(PageBreak())
    story.append(Paragraph("6. Missões de NPC e Trilhas / NPC Quests &amp; Questlines", styles["H1"]))
    story.extend(pt_en(
        "O RPGServer gerencia mais de 50 missões em YAML, organizadas por arquétipo (Guerreiro, "
        "Construtor, Mercador) e por categoria (diárias, semanais, cooperativas, resgate, exploração).",
        "RPGServer manages 50+ YAML quests, organized by archetype (Warrior, Builder, Merchant) and "
        "by category (daily, weekly, co-op, rescue, exploration)."))
    story.append(Paragraph("Estrutura de uma missão / Quest structure", styles["H2"]))
    story.append(bullets([
        "<b>id, name, archetype, description</b> — identidade e narrativa.",
        "<b>requires</b> — lista de IDs de missões pré-requisito, formando trilhas não-lineares.",
        "<b>objectives</b> — tipos extensíveis: build_region, kill_mob, custom_mob_kill, mine_block, "
        "earn_money, shop_buy/sell, join_town, discover_poi, discover_biome, enter_combat, vein_mine…",
        "<b>rewards</b> — money (Vault), skill-xp (AuraSkills), civs-skill-xp, permission/lp-group "
        "(LuckPerms), essentials-kit, warp, loot-table.",
    ]))
    story.append(Paragraph("Trilhas de arquétipo / Archetype paths", styles["H2"]))
    story.extend(pt_en(
        "Cada arquétipo tem uma trilha própria e não-sobreposta de missões que termina em uma missão "
        "capstone, desbloqueando a escolha de um perk avançado e, eventualmente, o Renascimento. "
        "Escolher uma trilha bloqueia as outras (ARCHETYPE_LOCKED) para reforçar identidade de "
        "personagem, como em Skyrim.",
        "Each archetype has its own non-overlapping quest path ending in a capstone quest that "
        "unlocks an advanced perk choice and, eventually, Rebirth. Picking a path locks the others "
        "(ARCHETYPE_LOCKED) to reinforce character identity, similar to Skyrim."))
    story.append(Paragraph("Descoberta e exploração / Discovery &amp; exploration", styles["H2"]))
    story.extend(pt_en(
        "O DiscoveryService rastreia Pontos de Interesse (POIs) e biomas visitados pelo jogador, "
        "alimentando o Codex (equivalente ao diário de exploração de Valheim) e objetivos "
        "discover_poi/discover_biome.",
        "DiscoveryService tracks Points of Interest (POIs) and biomes visited by the player, feeding "
        "the Codex (a Valheim-style exploration journal) and discover_poi/discover_biome objectives."))

    # 7. Economy
    story.append(Paragraph("7. Economia / Economy", styles["H1"]))
    story.extend(pt_en(
        "Vault é a base econômica obrigatória. Cidades têm banco próprio alimentado por upkeep de "
        "regiões (ex.: pousadas de NPC pagam ao banco da cidade); jogadores ganham dinheiro por "
        "missões, vendas em lojas (ChestShop) e leilão (Auction BIN) nativo do Civs.",
        "Vault is the mandatory economic backbone. Towns have their own bank fed by region upkeep "
        "(e.g. NPC hovels pay into the town bank); players earn money from quests, ChestShop sales, "
        "and Civs' native Auction BIN."))

    # 8. Skills & progression
    story.append(Paragraph("8. Skills e Progressão / Skills &amp; Progression", styles["H1"]))
    story.extend(pt_en(
        "Duas camadas de skill coexistem por design: <b>skills internas do Civs</b> (mineração, "
        "construção, combate corpo-a-corpo/à distância — ligadas a XP territorial e desbloqueios de "
        "loja) e <b>AuraSkills</b> (combate, exploração, etc. — a fonte de verdade para XP de RPG). "
        "O RPGServer nunca duplica XP entre as duas.",
        "Two skill layers coexist by design: <b>Civs internal skills</b> (mining, building, melee/"
        "ranged combat — tied to territorial XP and shop unlocks) and <b>AuraSkills</b> (combat, "
        "exploration, etc. — the source of truth for RPG XP). RPGServer never duplicates XP between "
        "the two."))
    story.append(Paragraph("Árvore de habilidades (estilo Skyrim) / Skill tree", styles["H2"]))
    story.extend(pt_en(
        "A SkillTreeGui apresenta perks organizados por ramo e tier, com grupos exclusivos e custo em "
        "\"Essência de Trilha\" (Path Essence) — obtida ao completar missões e no Renascimento.",
        "SkillTreeGui presents perks organized by branch and tier, with exclusive groups and a "
        "\"Path Essence\" cost — earned by completing quests and via Rebirth."))
    story.append(Paragraph("Renascimento (Rebirth)", styles["H2"]))
    story.extend(pt_en(
        "Ao atingir a missão capstone de uma trilha, o jogador pode renascer: reinicia a progressão de "
        "arquétipo mas mantém o Codex e recebe de volta 60% da Essência de Trilha investida, incentivando "
        "repetição de conteúdo sem perder o progresso de exploração.",
        "On reaching a path's capstone quest, the player may rebirth: archetype progression resets "
        "but the Codex is kept and 60% of invested Path Essence is refunded, encouraging content "
        "replay without losing exploration progress."))

    # 9. GUI / UX
    story.append(PageBreak())
    story.append(Paragraph("9. Interface e Navegação / GUI &amp; Navigation", styles["H1"]))
    story.extend(pt_en(
        "O Player Hub (bússola de recuperação) é o menu central do RPG — abas Início, Civs, RPG, "
        "Config e Quests — e serve como ponte para os menus nativos do Civs (cidades, portos, lojas). "
        "A navegação de volta do Civs para o Hub é resolvida sem fechar/reabrir tudo: ao pressionar "
        "\"voltar\" no menu raiz do Civs aberto pelo Hub, o RPGServer intercepta o clique e reabre o "
        "Hub na aba correta.",
        "The Player Hub (recovery compass) is the RPG's central menu — Início, Civs, RPG, Config and "
        "Quests tabs — and bridges into Civs' native menus (towns, ports, shops). Navigating back from "
        "Civs to the Hub no longer requires closing everything: pressing \"back\" on the Civs root menu "
        "opened from the Hub is intercepted by RPGServer, which reopens the Hub on the correct tab."))
    story.append(bullets([
        "<b>Diário de Missões (QuestJournalGui)</b> — lista, aceita e rastreia missões.",
        "<b>Árvore de Skills (SkillTreeGui)</b> — perks estilo constelação.",
        "<b>Codex (CodexGui)</b> — POIs e biomas descobertos.",
        "<b>Menus Civs (CustomMenu)</b> — cidades, portos/teleporte, lojas, regiões, leilão.",
    ]))

    # 10. Deployment
    story.append(Paragraph("10. Notas de Implantação / Deployment Notes", styles["H1"]))
    story.append(bullets([
        "Plataforma: Paper 26.1.2, Java 25.",
        "Civs: hard-depend Vault; server data autoritativo em <i>Civs_servidor/</i>.",
        "RPGServer: soft-depend Civs, AuraSkills, ChestShop, Essentials, LuckPerms, PlaceholderAPI, VeinMiner.",
        "Build: Maven (<i>mvn test</i> no Civs antes de cada commit; RPGServer compila contra o JAR do Civs "
        "via system-path).",
        "Deploy em produção: SSH/WSL para <i>daniel@bot-server</i>, parada completa antes de trocar JARs "
        "(nunca hot-swap — causa NoClassDefFoundError para classes novas).",
        "Regiões já construídas não herdam automaticamente novos efeitos de YAML — reconstrua a região "
        "(ex.: sala do conselho) após atualizar o item-type.",
    ], style="Body"))
    story.append(Spacer(1, 0.6 * cm))
    story.extend(pt_en(
        "Este documento resume o escopo vivo do projeto; consulte os skills em <i>.cursor/skills/</i> "
        "de cada repositório para detalhes de implementação atualizados.",
        "This document summarizes the project's living scope; see the .cursor/skills/ folders in each "
        "repo for up-to-date implementation details."))

    return story


def main():
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(OUT_PATH),
        pagesize=A4,
        leftMargin=2.2 * cm,
        rightMargin=2.2 * cm,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
        title="Civs + RPGServer - Documento de Escopo do Projeto",
        author="Daniel730",
    )
    doc.build(build_story())
    print(f"Wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
