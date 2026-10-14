from datetime import datetime, timezone

ts = 1775492812
dt = datetime.fromtimestamp(ts, tz=timezone.utc)
print(dt.isoformat())
