import numpy as np

a = np.random.randn(384)
a = a / np.linalg.norm(a) # normalize

b = np.random.randn(384)
b = b - np.dot(b, a) * a
b = b / np.linalg.norm(b)

assert abs(np.linalg.norm(a) - 1.0) < 1e-6, "VEC_A not normalized"
assert abs(np.linalg.norm(b) - 1.0) < 1e-6, "VEC_B not normalized"
assert abs(np.dot(a, b)) < 1e-6, "Vectors not orthogonal"

al = a.tolist()
bl = b.tolist()

out_a = "const VEC_A: [f32; 384] = [\n"
out_b = "const VEC_B: [f32; 384] = [\n"
for i in range(0, 384, 8):
    out_a += "    " + ", ".join(str(x) for x in al[i:i+8]) + ",\n"
    out_b += "    " + ", ".join(str(x) for x in bl[i:i+8]) + ",\n"

out_a += "];"
out_b += "];"

print(out_a)
print(out_b)

print(np.dot(a, b))