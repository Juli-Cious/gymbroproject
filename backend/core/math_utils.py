import numpy as np

def calculate_3d_angle(a, b, c):
    """Calculates the 3D angle at joint 'b' given 3D coordinates of a, b, c."""
    a = np.array(a) # [x, y, z]
    b = np.array(b)
    c = np.array(c)

    ba = a - b
    bc = c - b

    cosine_angle = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc))
    angle = np.arccos(np.clip(cosine_angle, -1.0, 1.0))
    return np.degrees(angle)