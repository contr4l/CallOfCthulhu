"""Static's reviewed action captions; numbered navigation is not narrative prose."""
import re

# These source lines contain only “或者，回到 57”, so the location comes
# from the reviewed destination paragraph, not a fabricated action.
RETURN_CAPTIONS = {
    ("62", "57"): "返回棚屋", ("65", "57"): "返回棚屋",
    # The existing hand-reviewed rule override already supplies this action.
    ("69", "66"): "放下匕首，返回",
}


def static_choice_label(section, line, jump=None):
    jump = jump or re.search(r"(?:转到|回到)\s*(\d+)", line)
    if not jump:
        raise ValueError(f"{section}: no numbered navigation in {line!r}")
    # Only the actual numbered instruction marks the boundary. “回到小屋”
    # before it is part of the player's action and must remain intact.
    label = line[:jump.start()].strip("，。 *") or "继续"
    if label in {"或者", "要", "如果"}:
        reviewed = RETURN_CAPTIONS.get((str(section), jump[1]))
        if not reviewed:
            raise ValueError(f"{section}: incomplete action caption {line!r}")
        return reviewed
    return label
