from Base_classes.Fighter import Fighter
from Base_classes.UnitType import UnitType, prettify
from Base_classes.StatsBonus import StatsBonus
from Base_classes.BattleRound import BattleRound
from datetime import datetime
from tabulate import tabulate
import math
import json
import os

class Fight:
    """Represents a battle between two fighters and manages battle execution.
    
    Coordinates the battle loop, round calculations, result tracking, and reporting.
    
    Attributes:
        attacker (Fighter): Attacking fighter.
        defender (Fighter): Defending fighter.
        max_round (int): Maximum number of rounds before battle ends.
        num_rounds (int): Actual number of rounds the battle lasted.
        dont_save (bool): If True, doesn't save battle report to file.
    """
    def __init__(self, attacker: Fighter, defender: Fighter, max_round = 1500, dont_save= False):
        self.attacker = attacker
        self.defender = defender
        self.max_round = max_round

        self.num_rounds = -1
        self.dont_save = dont_save


    def battle(self, show_rounds_freq = -1):
        """Execute the battle simulation.
        
        Runs the battle loop, calculating each round until one side is eliminated or max_round is reached.
        
        Args:
            show_rounds_freq (int, optional): If > 0, prints battle state every N rounds. Defaults to -1 (no output).
        
        Returns:
            tuple: (attacker_remaining, defender_remaining) - total troops remaining for each side.
        """
        if show_rounds_freq > 0: BattleRound.DEBUG_FREQ = show_rounds_freq

        # Set roles for role-gated skills/widgets
        self.attacker.role = "attack"
        self.defender.role = "defense"

        self.attacker.calc(self.defender)
        self.defender.calc(self.attacker)

        army_min = min(self.attacker.get_sum_army(), self.defender.get_sum_army())
        end = False
        round_idx = 0

        while not end:   

            # Prepare
            self.attacker.rounds[round_idx] = BattleRound(self.attacker, self.defender, round_idx, army_min)
            self.defender.rounds[round_idx] = BattleRound(self.defender, self.attacker, round_idx, army_min)
            att_troops = self.attacker.rounds[round_idx].total_troops()
            def_troops = self.defender.rounds[round_idx].total_troops() 
            end = (att_troops == 0) or (def_troops == 0)

            # DEBUG
            if BattleRound.DEBUG and round_idx % BattleRound.DEBUG_FREQ == 0:
                print(f'\n\n⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩  ROUND {round_idx}  ⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩')
                print(f'⏩       ATT: {self.attacker.rounds[round_idx].print_round_troops()}         ---         DEF: {self.defender.rounds[round_idx].print_round_troops()}')
                print(f'⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩⏩')
            elif show_rounds_freq > 0 and (end or round_idx % show_rounds_freq == 0) and not end:
                print(f'R{round_idx + 1:3d} ⏩       ATT: {self.attacker.rounds[round_idx].print_round_troops()}       ---     DEF: {self.defender.rounds[round_idx].print_round_troops()}')

            if end or round_idx > self.max_round:
                break

            # Calc skills
            self.attacker.rounds[round_idx].calc_skills()
            self.defender.rounds[round_idx].calc_skills()

            # Calc benefits
            self.attacker.rounds[round_idx].calc_benefits()
            self.defender.rounds[round_idx].calc_benefits()

            # Get results
            self.attacker.rounds[round_idx].get_results()
            self.defender.rounds[round_idx].get_results()


            # print details
            if BattleRound.DEBUG:
                if round_idx == 0 or (round_idx % BattleRound.DEBUG_FREQ == 0):
                    print(f'\n⏩ R{round_idx} COEF RECAP:   ATT: {self.attacker.rounds[round_idx].print_round_coef()}   ---   DEF: {self.defender.rounds[round_idx].print_round_coef()}')
            
            # if round_idx == 10:
            #     print(" _____ Round effects:")
            #     for _eff in self.attacker.effects: #self.attacker.rounds[round_idx].round_effects:
            #         print(_eff.name)
            #     print(" _____ Round benefits:")
            #     for _ben in self.attacker.rounds[round_idx].round_benefits:
            #         print(_ben.id)
            #     # exit()

            round_idx += 1
        
        # print results
        self.num_rounds = round_idx
        att_remaining = {k: math.ceil(v) for k,v in self.attacker.rounds[round_idx].round_troops.items()}
        sum_att = sum(att_remaining.values())
        def_remaining = {k: math.ceil(v) for k,v in self.defender.rounds[round_idx].round_troops.items()}
        sum_def = sum(def_remaining.values())

        if show_rounds_freq > 0 or BattleRound.DEBUG:
            print('\n--------------- BATTLE ENDED  ----------------')
            print(f'🟩 Result: ({round_idx} rounds)    Attacker : {sum_att} ({prettify(att_remaining)})   -   Defender: {sum_def} ({prettify(def_remaining)})  ')
        
        if not self.dont_save:
            with open('last_battle_report.json', 'w+') as f:
                json.dump(self.battle_report(), f, indent=4)

        return sum_att, sum_def
    
    def print_skills_report(self):
        """Print formatted skill usage report for both fighters.
        
        Displays which effects triggered during the battle with activation counts.
        """
        # print(json.dumps(self.battle_report()["sim_skills_used"], indent= 4))
        print('\n---------- ATTACKER SKILLS')
        for effect in self.attacker.effects :
            if not effect.trigger_count: continue
            print(effect.get_report())
                
        print('\n---------- DEFENDER SKILLS')
        for effect in self.defender.effects :
            if not effect.trigger_count: continue
            print(effect.get_report())

    def battle_report(self):
        """Generate comprehensive battle report dictionary.
        
        Returns:
            dict: Report containing fighter configurations, results, and skill usage statistics.
        """
        report = {
            'time': datetime.now().strftime('%Y-%m-%d - %H:%M'),
            'attacker': {
                'name': self.attacker.name,
                'heroes': self.attacker.heroes,
                'troops': self.attacker.troops,
                'stats': self.attacker.stats.to_json(),
                'joiner_heroes': self.attacker.joiner_heroes,
            },
            'defender': {
                'name': self.defender.name,
                'heroes': self.defender.heroes,
                'troops': self.defender.troops,
                'stats': self.defender.stats.to_json(),
                'joiner_heroes': self.defender.joiner_heroes,
            },
            'sim_result':{
                'attacker': self.attacker.get_sum_army(self.num_rounds),
                'defender': self.defender.get_sum_army(self.num_rounds)
            },
            'sim_rounds' :self.num_rounds,
            'sim_skills_used':{
                'attacker': [
                    effect.get_report() for effect in self.attacker.effects if effect.trigger_count
                    ],
                'defender': [
                    effect.get_report() for effect in self.defender.effects if effect.trigger_count
                ],
            }
        }

        return report

    
    def format_report(self):
        """Print formatted battle report to console as a table.
        
        Displays fighters, stats, results, and skill usage in a readable grid format.
        """
        report = self.battle_report()
        att_is_winner = report['sim_result']['attacker'] > 0 
        headers = [f"ATTACKER ({report['attacker']['name']})    "+ ('✅' if att_is_winner else '❌'), '✦✦✦✦', f"DEFENDER ({report['defender']['name']})     " + ('❌' if att_is_winner else '✅')]
        lines= []
        # lines.append(['-',report['time'],'-'])
        for key in ['heroes', 'troops','stats']:
            # lines.append(['', key.upper(),''])
            lines.append([json.dumps(report['attacker'][key],indent=4) , key.upper(), json.dumps(report['defender'][key],indent=4)])
        lines.append(['✅' if att_is_winner else '❌','RESULT','❌' if att_is_winner else '✅'])
        lines.append([report['sim_result']['attacker'], f"{report['sim_rounds']} rounds", report['sim_result']['defender']])
        lines.append(['\n'.join(report['sim_skills_used']['attacker']), 'SKILLS REPORT', '\n'.join(report['sim_skills_used']['defender'])])
        print(tabulate(lines, headers=headers, tablefmt="fancy_grid", colalign=("left", "center", "left")))
                
        # print('----------')
        # print(report['sim_skills_used']['attacker'])
        # print('----------')
        # print(report['sim_skills_used']['defender'])

    def save_testcase(self, file, result):
        """Save battle as a test case for validation.
        
        Args:
            file (str): Filename in testcases/ directory to save to.
            result (list): List of result dictionaries from game for comparison.
        """
        TESTCASES_DIR = "testcases/"

        ans = input(f"\n⚠️  Confirm to save testcase in '{file}' with result [ Attacker: {result[0]['attacker']} / Defender: {result[0]['defender']} ] : ")
        if ans.lower() not in ['yes', 'ok']:
            print(f"❌  Not saved !")
            return
        
        tests_dict = []
        try:
            with open(TESTCASES_DIR + file, 'r') as f:
                _f = f.read()
                if _f: tests_dict = json.loads(_f)
                if not tests_dict: tests_dict = []
        except:
            print(f"⚠️  File '{file}' will be created!")
        
        if self.num_rounds < 0:
            print(f"❌  Not saved. Battle not finished !")
            return
        
        test_case = {
            'test_id': f'{self.attacker.name}_{self.defender.name}_{len(tests_dict) + 1}',
            **self.battle_report()
        }
        test_case['game_report_result'] = [{
                'attacker': x['attacker'],
                'defender': x['defender']
            } for x in result]
        tests_dict.append(test_case)
        with open(TESTCASES_DIR + file, 'w+') as f:
            json.dump(tests_dict, f, indent=4)

        print('✅  Testcase saved !')
