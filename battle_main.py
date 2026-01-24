import json
from Base_classes.Fight import Fight
from Base_classes.Fighter import Fighter
from Base_classes.StatsBonus import StatsBonus
from Base_classes.BattleRound import BattleRound
from Base_classes.UnitType import UnitType
from Base_classes.JsonUtil import JsonUtil

###############################################
# LOAD FIGHTERS DATA
###############################################

JsonUtil.load_fighters_data(
    fighters_stats_path = "fighters_data/fighters_stats.json",      # File containing the fighters stats
    fighters_heroes_path = "fighters_data/fighters_heroes.json"     # File containing the fighters heroes stats
)


###############################################
# ATTACKER DATA
###############################################

attacker_name = "Kill"
attacker = Fighter(attacker_name)

# attacker.heroes = ["Sergey"]  #["Jessie", "Sergey", "Molly"]      # if this format is used, skill levels are fetched at 'fighter_heroes.json'; Level 5 if not found

### OR you can specify skill levels by using:
# attacker.heroes = {
#     "Mia" : {
#         "skill_1_level": 5,
#         "skill_2_level": 5,
#         "skill_3_level": 5
#     }
# }

# attacker.joiner_heroes = ['Seo-yoon','Jessie','Jessie','Jessie'] 

attacker.troops = {
    "infantry_t1"   : 2000,
    "infantry_t8"   : 1,
    "lancer_t6"      : 50,
    "lancer_t1"    : 5000
    }
# attacker.troops = {
#     "infantry_t2"   : 2000,
#     "lancer_t2"      : 3000
# }

### Add heroes stats. # If this is used, hero stats are added. All heroes stats should be specified in 'fighters_heroes.json'
### Use only if heroes stats are not included in fighters_data/fighter_stats.json
# attacker.add_heroes_stats()           


# attacker.joiner_heroes = ['Jessie', 'Jasser', 'mOLLY', "mia"]   ## If this form is used, all joiners first skill are considered at level 5

###############################################
# DEFENDER DATA
###############################################

defender = Fighter("Beast_15")

# defender.heroes = ["Hector"] # ["Flint", "Patrick", "Seo-yoon"]     

defender.troops = {
    "infantry_t5"   : 1120,
    "lancer_t5"      : 1310,
    "marksman_t5"    : 1310
}


# defender.troops = {
#     "infantry_t6"   : 2595,
#     "lancer_t6"      : 3025,
#     "marksman_t6"    : 3025
# }

# defender.add_heroes_stats()           

# defender.joiner_heroes = ['Jessie', 'Jasser', 'Molly', "mia"]   


###############################################
### BATTLE & Print results
###############################################

BattleRound.DEBUG = False
f = Fight(attacker, defender)
f.battle(show_rounds_freq = 5)

# f.format_report()


###############################################
# Save test case for future checking : Type 'yes' to confirm
###############################################

# f.save_testcase(
#     file = "4-testcases_no-heroes_fc_mixed",                 #"3-testcases_mixed-heroes-not-verified.json", # "heroes_unittests/Jessie_tc_nc.json",
#     result = [{
#         "attacker": 0,
#         "defender": 45772
#     }])
