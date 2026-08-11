from pathlib import Path
p = Path(r"C:\Users\Danie\Downloads\Civs-1.11.6\Civs-1.11.6\Civs_servidor\translations\pt_br.yml")
text = p.read_text(encoding="utf-8")
text2 = text.replace(
    "spell-command: Equipe magias nos slots vazios e use /cv spells para colocá-las na hotbar.",
    "spell-command: Equipe magias nos slots e use /cv spells para o modo combate (substitui a hotbar temporariamente).",
)
text2 = text2.replace(
    "switch-spell-cast: Segure este item e clique direito para lançar.",
    "switch-spell-cast: Clique direito para lançar. Role a roda à vontade — não lança ao trocar de slot.\n"
    "combat-bar-enabled: \"Modo combate ON — magias na hotbar. Clique direito para lançar. /cv spells para sair e restaurar ferramentas.\"\n"
    "combat-bar-disabled: \"Modo combate OFF — ferramentas restauradas. Use /cv spells quando precisar das magias.\"\n"
    "combat-bar-exit-hint: Clique direito para lançar. /cv spells sai do modo combate e restaura suas ferramentas.",
)
text2 = text2.replace("@{RED]$1 tem uma recarga infinita", "@{RED}$1 tem uma recarga infinita")
p.write_text(text2, encoding="utf-8")
print("ok", text != text2)
