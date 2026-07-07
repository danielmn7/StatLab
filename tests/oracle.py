import math, json

A = [5.1, 4.9, 6.2, 5.7, 5.5, 6.0, 5.8]
B = [6.1, 6.3, 5.9, 6.8, 6.5, 7.0, 6.2]
P1 = [120, 132, 125, 140, 128, 135, 122, 130]
P2 = [115, 128, 120, 138, 122, 130, 119, 127]
G1 = [22, 24, 21, 25, 23]
G2 = [30, 28, 31, 27, 29]
G3 = [26, 25, 27, 24, 28]
X = [1, 2, 3, 4, 5, 6, 7, 8]
Y = [2.1, 3.9, 6.2, 7.8, 10.1, 12.2, 13.8, 16.1]

def mean(a): return sum(a)/len(a)
def var(a):
    m=mean(a); return sum((x-m)**2 for x in a)/(len(a)-1)

def pooled_t(a,b):
    n1,n2=len(a),len(b); m1,m2=mean(a),mean(b); v1,v2=var(a),var(b)
    sp2=((n1-1)*v1+(n2-1)*v2)/(n1+n2-2)
    se=math.sqrt(sp2*(1/n1+1/n2)); t=(m1-m2)/se; df=n1+n2-2
    return t,df

def welch_t(a,b):
    n1,n2=len(a),len(b); m1,m2=mean(a),mean(b); v1,v2=var(a),var(b)
    se=math.sqrt(v1/n1+v2/n2); t=(m1-m2)/se
    df=(v1/n1+v2/n2)**2/((v1/n1)**2/(n1-1)+(v2/n2)**2/(n2-1))
    return t,df

def paired_t(a,b):
    d=[x-y for x,y in zip(a,b)]; n=len(d); md=mean(d); s=math.sqrt(var(d))
    return md/(s/math.sqrt(n)), n-1

def anova(groups):
    N=sum(len(g) for g in groups); grand=sum(sum(g) for g in groups)/N
    k=len(groups); ssb=sum(len(g)*(mean(g)-grand)**2 for g in groups)
    ssw=sum(sum((x-mean(g))**2 for x in g) for g in groups)
    dfb=k-1; dfw=N-k; F=(ssb/dfb)/(ssw/dfw)
    return F,dfb,dfw,ssb,ssw

def ranks(vals):
    idx=sorted(range(len(vals)), key=lambda i: vals[i])
    r=[0]*len(vals); i=0
    while i<len(idx):
        j=i
        while j+1<len(idx) and vals[idx[j+1]]==vals[idx[i]]: j+=1
        avg=(i+j)/2+1
        for k in range(i,j+1): r[idx[k]]=avg
        i=j+1
    return r

def mann_whitney(a,b):
    allv=a+b; rk=ranks(allv); R1=sum(rk[:len(a)])
    U1=R1-len(a)*(len(a)+1)/2; U2=len(a)*len(b)-U1
    return min(U1,U2),U1,U2

def wilcoxon(a,b):
    diffs=[x-y for x,y in zip(a,b) if x-y!=0]
    rk=ranks([abs(d) for d in diffs])
    Wp=sum(rk[i] for i,d in enumerate(diffs) if d>0)
    Wn=sum(rk[i] for i,d in enumerate(diffs) if d<0)
    return min(Wp,Wn),Wp,Wn

def kruskal(groups):
    allv=[x for g in groups for x in g]; N=len(allv); rk=ranks(allv)
    off=0; H=0
    for g in groups:
        R=sum(rk[off:off+len(g)]); H+=R*R/len(g); off+=len(g)
    H=12/(N*(N+1))*H-3*(N+1)
    # tie correction
    from collections import Counter
    cnt=Counter(allv); tie=sum(t**3-t for t in cnt.values())
    Cc=1-tie/(N**3-N)
    return H/Cc, len(groups)-1

def pearson(x,y):
    n=len(x); mx,my=mean(x),mean(y)
    sxy=sum((x[i]-mx)*(y[i]-my) for i in range(n))
    sxx=sum((x[i]-mx)**2 for i in range(n)); syy=sum((y[i]-my)**2 for i in range(n))
    return sxy/math.sqrt(sxx*syy)

def spearman(x,y):
    return pearson(ranks(x),ranks(y))

def regression(x,y):
    n=len(x); mx,my=mean(x),mean(y)
    sxx=sum((xi-mx)**2 for xi in x); sxy=sum((x[i]-mx)*(y[i]-my) for i in range(n))
    syy=sum((yi-my)**2 for yi in y)
    slope=sxy/sxx; intercept=my-slope*mx
    ssres=sum((y[i]-(intercept+slope*x[i]))**2 for i in range(n))
    return slope,intercept,1-ssres/syy

out={
 "pooled_t": pooled_t(A,B),
 "welch_t": welch_t(A,B),
 "paired_t": paired_t(P1,P2),
 "anova": anova([G1,G2,G3]),
 "mann_whitney": mann_whitney(A,B),
 "wilcoxon": wilcoxon(P1,P2),
 "kruskal": kruskal([G1,G2,G3]),
 "pearson": pearson(X,Y),
 "spearman": spearman(X,Y),
 "regression": regression(X,Y),
 "meanA": mean(A), "sdA": math.sqrt(var(A)),
}
print(json.dumps(out, indent=0))
