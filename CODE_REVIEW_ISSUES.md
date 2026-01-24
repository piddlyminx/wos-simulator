# Code Review - Potential Issues and Improvements

## ✅ FIXED ISSUES

### 1. ✅ Reference vs Copy in calc_round_troops (BattleRound.py:44)
**Status:** FIXED - Now uses `.copy()`

### 2. ✅ Division by Zero Protection (BattleRound.py:314-318)
**Status:** FIXED - Has denominator protection with `if denominator == 0 or denominator < 1e-10`

### 3. ✅ Mutable Default Argument (Hero.py:48)
**Status:** FIXED - Uses `hero_skill_levels = None`

### 5. ✅ Typo in Error Message (Skill.py:211)
**Status:** FIXED - Changed "effeect" to "effect"

### 6. ✅ __repr__ Implementation (StatsBonus.py:44)
**Status:** FIXED - Returns proper string representation

### 7. ✅ Missing Validation in calc_benefits (BattleRound.py:95-96)
**Status:** FIXED - Has `target = self.targets.get(ut)` and `if target is None: continue`

### 9. ✅ Magic Numbers (BattleRound.py:11, 157)
**Status:** FIXED - Added `FATIGUE_FACTOR = 0.01 / 100` as class constant

### 10. ✅ Repeated Dictionary Lookups (BattleRound.py:197-220)
**Status:** FIXED - Cached dictionary references with `effect_dict` and `opp_effect_dict`

### 11. ✅ Redundant List Comprehensions (Skill.py:6, 193, 203)
**Status:** FIXED - Added `ALL_UNIT_TYPES = list(UnitType)` at module level

### 14. ✅ Missing Docstrings
**Status:** FIXED - Added comprehensive Google-style docstrings to all classes and methods
**Location:** All Base_classes files (BattleRound, Fighter, Hero, Skill, Effect, RoundEffect, Benefit, UnitType, StatsBonus, Fight, JsonUtil)
**Impact:** Significantly improved code maintainability and readability

---

## ❌ REMAINING ISSUES

### 4. ❌ Random State Not Reset Between Battles (Skill.py:66-70)
**Issue:** `self.procs` dictionary persists across battles if Skill objects are reused
```python
# Add a reset method to Skill class:
def reset_for_new_battle(self):
    self.procs = {}

# Add to Fighter class:
def reset_for_new_battle(self):
    for skill in self.skills:
        skill.reset_for_new_battle()
    for effect in self.effects:
        effect.trigger_count = 0
        effect.activations_count = 0
        effect.uses_count = 0
        effect.extra_kills = 0
        effect.last_round = None

# Call in Fight.battle():
def battle(self, show_rounds_freq = -1):
    self.attacker.reset_for_new_battle()
    self.defender.reset_for_new_battle()
    # ... rest of code
```
**Impact:** For statistical analysis with multiple battles, `procs` accumulates and can cause incorrect reuse of random rolls
**Severity:** MEDIUM (only matters when running multiple battles)

### 8. ❌ Shared Benefit Objects (BattleRound.py:118-123)
**Issue:** Benefits from previous rounds are reused by reference
```python
# CURRENT:
for benefit in self.fighter.rounds[self.round_idx - 1].round_benefits:
    benefit: Benefit
    if benefit.is_valid("any", "any", self.round_idx):
        self.round_benefits.append(benefit)  # Same object reference
```
**Impact:** If benefit state is modified, it affects previous rounds
**Severity:** LOW (Benefit objects appear to be read-only after creation)

---

## 🔧 CODE QUALITY ISSUES

### 12. ❌ Inconsistent Naming Conventions
- Some methods use `calc_*`, others use `get_*`
- Some variables use camelCase (`oppDamageDown`), others use snake_case (`unit_base_dmg`)

### 13. ❌ Comment Formatting
- Many commented-out code blocks should be removed or documented why they're kept
- Example: BattleRound.py lines 107-121 (commented SOS Model)

---

## 📊 SUMMARY

**Total Issues:** 14
- **Fixed:** 10 ✅
- **Remaining:** 4 ❌

**Remaining by Priority:**
- **MEDIUM:** 1 (Issue #4 - Random State Reset for multiple battles)
- **LOW:** 3 (Issues #8, #12, #13)

**Quick Wins (Easy to fix):**
- Issue #4 - Add reset methods (requires careful implementation for statistical analysis)