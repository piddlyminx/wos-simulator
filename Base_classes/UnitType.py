from enum import Enum
import json

class UnitType(Enum):
    """Enum representing the three unit types in the game.
    
    Attributes:
        inf: Infantry unit type.
        lanc: Lancer unit type.
        mark: Marksman unit type.
    """
    inf = "inf"
    lanc = "lanc"
    mark = "mark"

    @classmethod
    def list(cls):
        """Return list of all unit types.
        
        Returns:
            list: List of all UnitType enum values.
        """
        return list(c for c in UnitType)


def _to_unitx(id_str):
    """Convert string identifier to UnitType enum.
    
    Performs case-insensitive matching on common unit type strings.
    
    Args:
        id_str (str): String containing unit type identifier ('INF', 'LANC', 'MARK', etc.).
    
    Returns:
        UnitType or None: Corresponding UnitType enum value, or None if no match.
    """
    uid = id_str.upper()
    if "INF" in uid:
        return UnitType.inf
    if "LANC" in uid:
        return UnitType.lanc
    if "MARK" in uid:
        return UnitType.mark
    return None
    
def prettify(_dict, precision= 2, _json= False):
    """Format a unit type dictionary for display.
    
    Args:
        _dict (dict): Dictionary mapping UnitType to numeric values.
        precision (int, optional): Number of decimal places for rounding. Defaults to 2.
        _json (bool, optional): If True, returns dict with string keys; if False, returns formatted string. Defaults to False.
    
    Returns:
        dict or str: Either dictionary with string keys or formatted string like '100 / 200 / 300'.
    """
    if _json: return { k.name : v for k,v in _dict.items() }
    else : 
        return ' / '.join("{}".format(round(_dict[v],precision)) for v in UnitType)
